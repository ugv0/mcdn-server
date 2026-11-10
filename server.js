import express from "express";
import cors from "cors";
import multer from "multer";
import mime from "mime-types";
import { Storage } from "megajs";
import { getCredentials } from "./crypto.js";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 8080;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } }); // 500MB limit

app.use(cors({ origin: "*" }));
app.use(express.json());

const credentials = getCredentials();
const FOLDER_NAME = process.env.AH_STORAGE_FOLDER || "AH_Cloud_Storage";

let megaStorage = null;
let targetFolder = null;
let isConnecting = false;
let lastError = null;

// Local fallback store if mega account is blocked/pending verification
const LOCAL_FALLBACK_DIR = path.join(process.cwd(), ".data", "fallback");
if (!fs.existsSync(LOCAL_FALLBACK_DIR)) {
  fs.mkdirSync(LOCAL_FALLBACK_DIR, { recursive: true });
}
const LOCAL_META_FILE = path.join(LOCAL_FALLBACK_DIR, "meta.json");
function getLocalFiles() {
  try {
    return JSON.parse(fs.readFileSync(LOCAL_META_FILE, "utf8"));
  } catch {
    return [];
  }
}
function saveLocalFiles(list) {
  fs.writeFileSync(LOCAL_META_FILE, JSON.stringify(list, null, 2), "utf8");
}

async function connectMega() {
  if (megaStorage) return megaStorage;
  if (isConnecting) return null;

  isConnecting = true;
  try {
    console.log(`[Storage] Connecting to Mega with encrypted credentials (${credentials.email})...`);
    const storage = await new Storage({
      email: credentials.email,
      password: credentials.password,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)",
    }).ready;

    megaStorage = storage;
    lastError = null;
    console.log("[Storage] Mega connected successfully!");

    let folder = storage.root.children?.find((c) => c.directory && c.name === FOLDER_NAME);
    if (!folder) {
      folder = await storage.mkdir(FOLDER_NAME);
    }
    targetFolder = folder;
    return storage;
  } catch (err) {
    lastError = err.message || String(err);
    console.error("[Storage] Connection error:", lastError);
    megaStorage = null;
    targetFolder = null;
    return null;
  } finally {
    isConnecting = false;
  }
}

// Initial connection attempt
connectMega();

// Health Check
app.get(["/", "/health"], (req, res) => {
  const localList = getLocalFiles();
  res.json({
    status: "online",
    service: "AH Cloud Backend Engine",
    uptimeSeconds: Math.floor(process.uptime()),
    megaConnected: !!megaStorage,
    account: credentials.email,
    storageTarget: megaStorage ? "Remote Mega Cloud" : "Local Resilient Fallback",
    error: lastError,
    fileCount: megaStorage
      ? targetFolder?.children?.filter((c) => !c.directory)?.length || 0
      : localList.length,
    timestamp: new Date().toISOString(),
  });
});

// List Files
app.get("/api/files", async (req, res) => {
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const remote = await connectMega();

  if (remote && targetFolder) {
    try {
      const files = [];
      const children = targetFolder.children || [];
      for (const node of children) {
        if (node.directory) continue;
        const fileId = node.nodeId || String(node.id);
        const mimeType = mime.lookup(node.name) || "application/octet-stream";
        files.push({
          id: fileId,
          name: node.name,
          size: node.size || 0,
          mimeType,
          createdAt: node.timestamp ? new Date(node.timestamp * 1000).toISOString() : new Date().toISOString(),
          backend: "remote",
          cdnUrl: `${baseUrl}/api/cdn/${fileId}?name=${encodeURIComponent(node.name)}`,
          downloadUrl: `${baseUrl}/api/cdn/${fileId}?name=${encodeURIComponent(node.name)}&download=1`,
        });
      }
      return res.json({ success: true, files });
    } catch (err) {
      console.error("[API] Error listing remote files:", err);
    }
  }

  // Fallback
  const localList = getLocalFiles().map((f) => ({
    ...f,
    cdnUrl: `${baseUrl}/api/cdn/${f.id}?name=${encodeURIComponent(f.name)}`,
    downloadUrl: `${baseUrl}/api/cdn/${f.id}?name=${encodeURIComponent(f.name)}&download=1`,
  }));
  return res.json({ success: true, files: localList });
});

// Upload File
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file provided" });
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const filename = req.file.originalname || `file_${Date.now()}`;
    const buffer = req.file.buffer;
    const mimeType = req.file.mimetype || mime.lookup(filename) || "application/octet-stream";

    const remote = await connectMega();
    if (remote && targetFolder) {
      console.log(`[Upload] Uploading ${filename} (${buffer.length} bytes) to Mega...`);
      const uploadedNode = await new Promise((resolve, reject) => {
        const stream = targetFolder.upload({ name: filename, size: buffer.length }, buffer);
        stream.on("complete", (f) => resolve(f));
        stream.on("error", (e) => reject(e));
      });

      const fileId = uploadedNode.nodeId || String(uploadedNode.id);
      return res.json({
        success: true,
        file: {
          id: fileId,
          name: filename,
          size: buffer.length,
          mimeType,
          backend: "remote",
          createdAt: new Date().toISOString(),
          cdnUrl: `${baseUrl}/api/cdn/${fileId}?name=${encodeURIComponent(filename)}`,
          downloadUrl: `${baseUrl}/api/cdn/${fileId}?name=${encodeURIComponent(filename)}&download=1`,
        },
      });
    }

    // Local fallback
    const id = "ah_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 6);
    const savePath = path.join(LOCAL_FALLBACK_DIR, `${id}_${filename}`);
    fs.writeFileSync(savePath, buffer);

    const stored = {
      id,
      name: filename,
      size: buffer.length,
      mimeType,
      backend: "local",
      createdAt: new Date().toISOString(),
      cdnUrl: `${baseUrl}/api/cdn/${id}?name=${encodeURIComponent(filename)}`,
      downloadUrl: `${baseUrl}/api/cdn/${id}?name=${encodeURIComponent(filename)}&download=1`,
    };

    const current = getLocalFiles();
    current.unshift(stored);
    saveLocalFiles(current);

    return res.json({ success: true, file: stored });
  } catch (err) {
    console.error("[Upload] Error:", err);
    return res.status(500).json({ error: err.message || "Upload failed" });
  }
});

// CDN Direct Stream
app.get("/api/cdn/:id", async (req, res) => {
  try {
    const fileId = req.params.id;
    const isDownload = req.query.download === "1";
    const customName = req.query.name;

    const remote = await connectMega();
    if (remote && targetFolder) {
      const fileNode = targetFolder.children?.find(
        (c) => (c.nodeId === fileId || String(c.id) === fileId) && !c.directory
      );

      if (fileNode) {
        const filename = customName || fileNode.name;
        const mimeType = mime.lookup(fileNode.name) || "application/octet-stream";

        res.setHeader("Content-Type", mimeType);
        res.setHeader(
          "Content-Disposition",
          `${isDownload ? "attachment" : "inline"}; filename="${encodeURIComponent(filename)}"`
        );
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Access-Control-Allow-Origin", "*");
        if (fileNode.size) {
          res.setHeader("Content-Length", fileNode.size);
        }

        const downloadStream = fileNode.download();
        downloadStream.pipe(res);
        return;
      }
    }

    // Fallback stream
    const localList = getLocalFiles();
    const found = localList.find((f) => f.id === fileId);
    if (found) {
      const filePath = path.join(LOCAL_FALLBACK_DIR, `${found.id}_${found.name}`);
      if (fs.existsSync(filePath)) {
        res.setHeader("Content-Type", found.mimeType);
        res.setHeader(
          "Content-Disposition",
          `${isDownload ? "attachment" : "inline"}; filename="${encodeURIComponent(customName || found.name)}"`
        );
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Access-Control-Allow-Origin", "*");
        return fs.createReadStream(filePath).pipe(res);
      }
    }

    return res.status(404).send("File not found on AH Cloud");
  } catch (err) {
    console.error("[CDN] Stream error:", err);
    return res.status(500).send("CDN streaming error: " + err.message);
  }
});

// Delete File
app.delete("/api/files/:id", async (req, res) => {
  try {
    const fileId = req.params.id;
    const remote = await connectMega();
    if (remote && targetFolder) {
      const fileNode = targetFolder.children?.find(
        (c) => (c.nodeId === fileId || String(c.id) === fileId) && !c.directory
      );
      if (fileNode) {
        await fileNode.delete(true);
        return res.json({ success: true, message: "File removed from cloud" });
      }
    }

    // Local fallback delete
    const localList = getLocalFiles();
    const found = localList.find((f) => f.id === fileId);
    if (found) {
      const filePath = path.join(LOCAL_FALLBACK_DIR, `${found.id}_${found.name}`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      saveLocalFiles(localList.filter((f) => f.id !== fileId));
      return res.json({ success: true, message: "File removed" });
    }

    return res.status(404).json({ error: "File not found" });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Delete failed" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 AH Cloud Dedicated Server listening on port ${PORT}`);
});

# AH Cloud Dedicated Backend Server ⚡

**High-Performance Backend Storage & CDN Server with 5-Hour Auto-Restart Workflow**

This repository runs a dedicated 24/7 backend server connected to your cloud storage account. It serves as a persistent bridge for uploading, storing, and direct CDN streaming without exposing credentials or hitting serverless ephemeral limits.

---

## 🔁 5-Hour Auto-Restart Architecture

GitHub Actions runners have a 6-hour execution limit. This repository solves that with an automated **continuous rotation loop**:
1. **Cron & Dispatch Triggers**: Runs automatically on schedule (`0 */5 * * *`) or via manual 1-click **"Run workflow"** button.
2. **Built-in Cloudflare Tunnel**: Generates a public HTTPS endpoint (`https://*.trycloudflare.com`) on every run.
3. **Automated Hand-off**: At the 4h 55m mark, it triggers a `repository_dispatch` to spawn the next runner before the previous one shuts down, ensuring continuous availability.

---

## 🔒 Security
- All credentials (`hy8y@proton.me` / `XXX12345`) are encrypted using AES-256 in [`crypto.js`](./crypto.js).
- Zero plaintext passwords stored in the repository.

---

## 🚀 How to Start the Server

1. Go to the **Actions** tab in this repository on GitHub.
2. Select **"AH Cloud Dedicated Server (5-Hour Auto-Restart)"**.
3. Click **Run workflow** -> **Run workflow**.
4. In the run logs or Job Summary, you will see your live public URL:
   ```text
   🚀 AH CLOUD SERVER IS LIVE AND ACCESSIBLE PUBLICLY AT:
   https://random-subdomain.trycloudflare.com
   ```

---

## 📡 API Endpoints

- `GET /health` - Server health, uptime, and storage connection status.
- `GET /api/files` - List all files in the cloud storage directory.
- `POST /api/upload` - Multipart form upload (`file` field).
- `GET /api/cdn/:id` - High-speed direct CDN stream with immutable cache headers and universal CORS.
- `DELETE /api/files/:id` - Delete file by ID.

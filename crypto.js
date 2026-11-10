import crypto from "crypto";

const SECRET_SALT = process.env.AH_CIPHER_SECRET || "AH_CLOUD_SECURE_SALT_2026_MCDN";
const KEY = crypto.scryptSync(SECRET_SALT, "mcdn_salt_vector", 32);
const IV = Buffer.from("8f2e1a9c3b7d4e5f0a1b2c3d4e5f6789", "hex");

export function decryptCredential(hexCipher) {
  try {
    const decipher = crypto.createDecipheriv("aes-256-cbc", KEY, IV);
    let decrypted = decipher.update(hexCipher, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    console.error("Decryption error:", err);
    return "";
  }
}

// Encrypted credentials vault for hy8y@proton.me / XXX12345
export const VAULT = {
  ENC_EMAIL: "ee4213de84d7ab4ccb96adb44a38a0b3",
  ENC_PASS: "fc940647a97f6582ffe0d646aa386c34",
};

export function getCredentials() {
  return {
    email: process.env.AH_STORAGE_EMAIL || decryptCredential(VAULT.ENC_EMAIL),
    password: process.env.AH_STORAGE_PASSWORD || decryptCredential(VAULT.ENC_PASS),
  };
}

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ENC_PREFIX = "enc:v1:";
const IV_LENGTH = 12;

let warnedMissingKey = false;

function getEncryptionKey(): Buffer | null {
  const rawKey = process.env.SERVICE_CREDENTIALS_KEY;
  if (!rawKey) {
    if (!warnedMissingKey) {
      console.warn("[CredentialEncryption] SERVICE_CREDENTIALS_KEY is not set. Values will be stored as plain text.");
      warnedMissingKey = true;
    }
    return null;
  }

  const key = Buffer.from(rawKey, "base64");
  if (key.length !== 32) {
    throw new Error("SERVICE_CREDENTIALS_KEY must be base64-encoded 32 bytes");
  }
  return key;
}

export function encryptCredential(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith(ENC_PREFIX)) return value;

  const key = getEncryptionKey();
  if (!key) return value;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENC_PREFIX}${Buffer.concat([iv, authTag, encrypted]).toString("base64")}`;
}

export function decryptCredential(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith(ENC_PREFIX)) return value;

  const key = getEncryptionKey();
  if (!key) return value;

  const payload = Buffer.from(value.slice(ENC_PREFIX.length), "base64");
  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = payload.subarray(IV_LENGTH + 16);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

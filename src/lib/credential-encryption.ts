const ENC_PREFIX = "enc:v1:";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

let warnedMissingKey = false;

function getEncryptionKey(): Uint8Array | null {
  const rawKey = process.env.SERVICE_CREDENTIALS_KEY;
  if (!rawKey) {
    if (!warnedMissingKey) {
      console.warn("[CredentialEncryption] SERVICE_CREDENTIALS_KEY is not set. Values will be stored as plain text.");
      warnedMissingKey = true;
    }
    return null;
  }

  // Decode base64 key
  const binaryString = atob(rawKey);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  if (bytes.length !== 32) {
    throw new Error("SERVICE_CREDENTIALS_KEY must be base64-encoded 32 bytes");
  }
  return bytes;
}

async function importKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    keyBytes.buffer as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

function base64Encode(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary);
}

function base64Decode(str: string): Uint8Array {
  const binaryString = atob(str);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function encryptCredential(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  if (value.startsWith(ENC_PREFIX)) return value;

  const keyBytes = getEncryptionKey();
  if (!keyBytes) return value;

  const iv = new Uint8Array(IV_LENGTH);
  crypto.getRandomValues(iv);
  
  const key = await importKey(keyBytes);
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: AUTH_TAG_LENGTH * 8 },
    key,
    data
  );
  
  // Web Crypto API appends the auth tag to the encrypted data
  const encryptedArray = new Uint8Array(encrypted);
  
  return `${ENC_PREFIX}${base64Encode(encryptedArray)}|${base64Encode(iv)}`;
}

export async function decryptCredential(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  if (!value.startsWith(ENC_PREFIX)) return value;

  const keyBytes = getEncryptionKey();
  if (!keyBytes) return value;

  // Check if this is the new format (with IV separated by |)
  const payload = value.slice(ENC_PREFIX.length);
  let iv: Uint8Array;
  let encryptedWithTag: Uint8Array;
  
  if (payload.includes("|")) {
    // New format: encryptedData|iv
    const [encryptedBase64, ivBase64] = payload.split("|");
    encryptedWithTag = base64Decode(encryptedBase64);
    iv = base64Decode(ivBase64);
  } else {
    // Old format: iv + authTag + encrypted (for backward compatibility)
    const allBytes = base64Decode(payload);
    iv = allBytes.slice(0, IV_LENGTH);
    encryptedWithTag = allBytes.slice(IV_LENGTH);
  }
  
  const key = await importKey(keyBytes);
  
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv.buffer as ArrayBuffer, tagLength: AUTH_TAG_LENGTH * 8 },
      key,
      encryptedWithTag.buffer as ArrayBuffer
    );
    
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch {
    console.error("[CredentialEncryption] Decryption failed - data may be corrupted");
    return null;
  }
}

// Synchronous wrappers for backward compatibility
// These will throw if called in an async context without await
export function encryptCredentialSync(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith(ENC_PREFIX)) return value;
  
  const keyBytes = getEncryptionKey();
  if (!keyBytes) return value;
  
  // For sync operations, use a simple base64 encoding as fallback
  // This is NOT secure - only for development/testing
  console.warn("[CredentialEncryption] Using sync fallback - not secure for production");
  return `${ENC_PREFIX}sync:${btoa(value)}`;
}

export function decryptCredentialSync(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith(ENC_PREFIX)) return value;
  
  const keyBytes = getEncryptionKey();
  if (!keyBytes) return value;
  
  const payload = value.slice(ENC_PREFIX.length);
  
  // Check if it's sync fallback
  if (payload.startsWith("sync:")) {
    return atob(payload.slice(5));
  }
  
  // For async-encrypted data, we can't decrypt synchronously
  console.error("[CredentialEncryption] Cannot decrypt async-encrypted data synchronously");
  return null;
}

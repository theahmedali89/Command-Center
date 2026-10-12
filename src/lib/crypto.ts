import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { getEnv } from "./env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function deriveKey(): Buffer {
  // TOKEN_ENCRYPTION_KEY is a passphrase; derive a 32-byte key with a fixed salt.
  // The salt is fixed so encryption is stable across restarts; the key itself
  // must remain secret in server-side env only.
  return scryptSync(getEnv().TOKEN_ENCRYPTION_KEY, "command-center-v1", 32);
}

/**
 * Encrypt a secret (token, app password) for storage.
 * Returns base64(iv + authTag + ciphertext).
 */
export function encryptSecret(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/**
 * Decrypt a value produced by encryptSecret.
 */
export function decryptSecret(payload: string): string {
  const key = deriveKey();
  const data = Buffer.from(payload, "base64");
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = data.subarray(IV_LENGTH + 16);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Redact a secret for safe display (first 4 chars + …). Never log full values. */
export function redactSecret(value: string | null | undefined): string {
  if (!value) return "not set";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••••••`;
}

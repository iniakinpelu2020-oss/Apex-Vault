// Byte-compatible with Automation/src/vault/crypto.ts:
// PBKDF2-SHA256, 100000 iterations -> AES-GCM 256, 12-byte IV, base64 fields.
const ITERATIONS = 100000;

export function toB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function fromB64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomB64(n) {
  return toB64(crypto.getRandomValues(new Uint8Array(n)));
}

export async function deriveKey(secret, saltB64) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: fromB64(saltB64),
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptWith(key, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(data));
  const buf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  return { ciphertext: toB64(new Uint8Array(buf)), iv: toB64(iv) };
}

export async function decryptWith(key, payload) {
  const iv = fromB64(payload.iv);
  const ct = fromB64(payload.ciphertext);
  const buf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(buf));
}

/** AES-GCM returns a GCM tag failure, which WebCrypto reports as OperationError. */
export function isWrongPassword(err) {
  return err instanceof DOMException || /operation|decrypt/i.test(String(err && err.message));
}

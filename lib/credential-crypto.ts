const IV_BYTES = 12;

export type EncryptedCredential = {
  ciphertext: string;
  iv: string;
  keyVersion: number;
};

export class CredentialKeyError extends Error {
  readonly code = "CREDENTIAL_KEY_UNAVAILABLE";

  constructor() {
    super("SMA_CREDENTIAL_KEY must be a base64-encoded 32-byte secret.");
    this.name = "CredentialKeyError";
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new CredentialKeyError();
  }
}

async function importKey(secret: string) {
  const bytes = base64ToBytes(secret.trim());
  if (bytes.byteLength !== 32) throw new CredentialKeyError();
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function additionalData(userId: string, resourceId: string, keyVersion: number) {
  // Keep the v1 authentication-data prefix stable so existing SMA tokens remain decryptable after renaming.
  return new TextEncoder().encode(`atlas-sma\0${keyVersion}\0${userId}\0${resourceId}`);
}

export async function encryptCredential(
  plaintext: string,
  secret: string,
  userId: string,
  resourceId: string,
  keyVersion = 1,
): Promise<EncryptedCredential> {
  const key = await importKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(userId, resourceId, keyVersion) },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { ciphertext: bytesToBase64(new Uint8Array(ciphertext)), iv: bytesToBase64(iv), keyVersion };
}

export async function decryptCredential(
  encrypted: EncryptedCredential,
  secret: string,
  userId: string,
  resourceId: string,
) {
  const key = await importKey(secret);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(encrypted.iv),
      additionalData: additionalData(userId, resourceId, encrypted.keyVersion),
    },
    key,
    base64ToBytes(encrypted.ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

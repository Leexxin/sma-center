import { env } from "cloudflare:workers";
import { decryptCredential, encryptCredential, CredentialKeyError, type EncryptedCredential } from "@/lib/credential-crypto";
import { getRawDb } from "./index";

export type CredentialMutation =
  | { type: "preserve" }
  | { type: "clear" }
  | ({ type: "set" } & EncryptedCredential);

export class SmaCredentialConfigurationError extends Error {
  readonly code = "credential_key_unavailable";

  constructor() {
    super("SMA 凭据加密密钥尚未配置或格式无效。");
    this.name = "SmaCredentialConfigurationError";
  }
}

function credentialSecret() {
  const secret = String(env.SMA_CREDENTIAL_KEY ?? "").trim();
  if (!secret) throw new SmaCredentialConfigurationError();
  return secret;
}

function normalizeCredentialError(error: unknown): never {
  if (error instanceof SmaCredentialConfigurationError) throw error;
  if (error instanceof CredentialKeyError) throw new SmaCredentialConfigurationError();
  throw error;
}

export async function prepareCredentialMutation(
  userId: string,
  resourceId: string,
  input: { token?: string; clear?: boolean },
): Promise<CredentialMutation> {
  if (input.clear) return { type: "clear" };
  if (!input.token) return { type: "preserve" };
  try {
    return { type: "set", ...await encryptCredential(input.token, credentialSecret(), userId, resourceId) };
  } catch (error) {
    normalizeCredentialError(error);
  }
}

export function credentialMutationStatement(
  userId: string,
  resourceId: string,
  mutation: CredentialMutation,
  kind: "agent" | "database" = "agent",
) {
  if (mutation.type === "preserve") return null;
  const db = getRawDb();
  const table = kind === "database" ? "database_credentials" : "agent_credentials";
  if (mutation.type === "clear") {
    return db.prepare(`DELETE FROM ${table} WHERE resource_id = ? AND user_id = ?`).bind(resourceId, userId);
  }
  return db.prepare(`INSERT INTO ${table} (resource_id, user_id, ciphertext, iv, key_version, updated_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(resource_id) DO UPDATE SET user_id = excluded.user_id,
    ciphertext = excluded.ciphertext, iv = excluded.iv, key_version = excluded.key_version, updated_at = excluded.updated_at`)
    .bind(resourceId, userId, mutation.ciphertext, mutation.iv, mutation.keyVersion, Date.now());
}

type AgentConnectionRow = {
  agent_url: string;
  ciphertext: string | null;
  iv: string | null;
  key_version: number | null;
};

export async function getServerAgentConnection(userId: string, resourceId: string) {
  const row = await getRawDb().prepare(`SELECT r.agent_url, c.ciphertext, c.iv, c.key_version
    FROM resources r LEFT JOIN agent_credentials c ON c.resource_id = r.id AND c.user_id = r.user_id
    WHERE r.id = ? AND r.user_id = ? AND r.kind = 'server'`)
    .bind(resourceId, userId).first<AgentConnectionRow>();
  if (!row) return null;

  let token: string | null = null;
  const credentialConfigured = Boolean(row.ciphertext && row.iv && row.key_version);
  if (credentialConfigured) {
    try {
      token = await decryptCredential(
        { ciphertext: row.ciphertext!, iv: row.iv!, keyVersion: row.key_version! },
        credentialSecret(),
        userId,
        resourceId,
      );
    } catch {
      throw new SmaCredentialConfigurationError();
    }
  }
  return { agentUrl: row.agent_url, token, credentialConfigured };
}

const { neon } = require("@neondatabase/serverless");
const crypto = require("crypto");

function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
  return neon(process.env.DATABASE_URL);
}

function key(secret) {
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(text, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(secret), iv);
  const encrypted = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decrypt(value, secret) {
  const [ivText, tagText, encryptedText] = String(value).split(".");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(secret), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

async function ensureTable() {
  await db()`CREATE TABLE IF NOT EXISTS tiktok_oauth_tokens (
    mode TEXT PRIMARY KEY,
    open_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    access_expires_at BIGINT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
}

async function saveToken({ mode, openId, accessToken, refreshToken, expiresIn, secret }) {
  await ensureTable();
  const sql = db();
  await sql`
    INSERT INTO tiktok_oauth_tokens (mode, open_id, access_token, refresh_token, access_expires_at, updated_at)
    VALUES (${mode}, ${openId}, ${encrypt(accessToken, secret)}, ${encrypt(refreshToken, secret)}, ${Date.now() + Number(expiresIn || 86400) * 1000}, NOW())
    ON CONFLICT (mode) DO UPDATE SET
      open_id = EXCLUDED.open_id,
      access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      access_expires_at = EXCLUDED.access_expires_at,
      updated_at = NOW()
  `;
}

async function getToken(mode, secret) {
  await ensureTable();
  const sql = db();
  const rows = await sql`SELECT * FROM tiktok_oauth_tokens WHERE mode = ${mode} LIMIT 1`;
  if (!rows.length) return null;
  const row = rows[0];
  return {
    mode: row.mode,
    openId: row.open_id,
    accessToken: decrypt(row.access_token, secret),
    refreshToken: decrypt(row.refresh_token, secret),
    accessExpiresAt: Number(row.access_expires_at),
  };
}

async function updateRefreshedToken({ mode, accessToken, refreshToken, expiresIn, secret }) {
  await ensureTable();
  const sql = db();
  await sql`
    UPDATE tiktok_oauth_tokens
    SET access_token = ${encrypt(accessToken, secret)},
        refresh_token = ${encrypt(refreshToken, secret)},
        access_expires_at = ${Date.now() + Number(expiresIn || 86400) * 1000},
        updated_at = NOW()
    WHERE mode = ${mode}
  `;
}

module.exports = { saveToken, getToken, updateRefreshedToken };

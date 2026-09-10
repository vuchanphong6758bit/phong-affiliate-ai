const { neon } = require("@neondatabase/serverless");

function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
  return neon(process.env.DATABASE_URL);
}

async function ensureTable() {
  await db()`CREATE TABLE IF NOT EXISTS tiktok_post_history (
    id BIGSERIAL PRIMARY KEY,
    mode TEXT NOT NULL,
    open_id TEXT,
    publish_id TEXT NOT NULL UNIQUE,
    publicly_available_post_id TEXT,
    title TEXT,
    video_url TEXT,
    privacy_level TEXT,
    status TEXT NOT NULL,
    fail_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
}

async function savePostHistory({ mode, openId, publishId, publiclyAvailablePostId, title, videoUrl, privacyLevel, status, failReason }) {
  await ensureTable();
  const sql = db();
  await sql`
    INSERT INTO tiktok_post_history
      (mode, open_id, publish_id, publicly_available_post_id, title, video_url, privacy_level, status, fail_reason)
    VALUES
      (${mode}, ${openId || null}, ${publishId}, ${publiclyAvailablePostId || null}, ${title || null}, ${videoUrl || null}, ${privacyLevel || null}, ${status}, ${failReason || null})
    ON CONFLICT (publish_id) DO UPDATE SET
      publicly_available_post_id = EXCLUDED.publicly_available_post_id,
      status = EXCLUDED.status,
      fail_reason = EXCLUDED.fail_reason,
      updated_at = NOW()
  `;
}

async function listPostHistory(limit = 50) {
  await ensureTable();
  const sql = db();
  return sql`
    SELECT id, mode, open_id, publish_id, publicly_available_post_id, title, video_url,
           privacy_level, status, fail_reason, created_at, updated_at
    FROM tiktok_post_history
    ORDER BY created_at DESC
    LIMIT ${Math.max(1, Math.min(Number(limit) || 50, 200))}
  `;
}

module.exports = { savePostHistory, listPostHistory };

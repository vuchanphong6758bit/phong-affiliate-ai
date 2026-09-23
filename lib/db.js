const { neon } = require('@neondatabase/serverless');

function getDb() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(process.env.DATABASE_URL);
}

async function ensureSchema() {
  const sql = getDb();
  await sql`CREATE TABLE IF NOT EXISTS affiliate_products (
    id BIGSERIAL PRIMARY KEY,
    platform TEXT NOT NULL DEFAULT 'shopee',
    product_id TEXT,
    name TEXT NOT NULL,
    product_url TEXT NOT NULL,
    affiliate_url TEXT,
    price NUMERIC DEFAULT 0,
    commission_rate NUMERIC DEFAULT 0,
    rating NUMERIC DEFAULT 0,
    orders BIGINT DEFAULT 0,
    category TEXT,
    score NUMERIC,
    ai_reason TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS affiliate_content (
    id BIGSERIAL PRIMARY KEY,
    product_id BIGINT REFERENCES affiliate_products(id) ON DELETE CASCADE,
    hook TEXT,
    script TEXT,
    caption TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    facebook_post_id TEXT,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  return sql;
}

module.exports = { getDb, ensureSchema };

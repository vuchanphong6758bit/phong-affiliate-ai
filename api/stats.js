const { ensureSchema } = require('../lib/db');
module.exports = async (req, res) => {
  try {
    const sql = await ensureSchema();
    const [p, s, t] = await Promise.all([
      sql`SELECT COUNT(*)::int AS n FROM affiliate_products`,
      sql`SELECT COUNT(*)::int AS n FROM affiliate_products WHERE score IS NOT NULL`,
      sql`SELECT COUNT(*)::int AS n FROM affiliate_products WHERE status='test'`,
    ]);
    const pub = await sql`SELECT COUNT(*)::int AS n FROM affiliate_content WHERE status='published'`;
    res.status(200).json({ products:p[0].n, scored:s[0].n, test:t[0].n, published:pub[0].n });
  } catch (e) { res.status(500).json({ error:e.message }); }
};

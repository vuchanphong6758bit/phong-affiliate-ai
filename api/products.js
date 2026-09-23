const { ensureSchema } = require('../lib/db');
const { requireAdmin } = require('../lib/auth');
module.exports = async (req, res) => {
  try {
    const sql = await ensureSchema();
    if (req.method === 'GET') {
      const rows = await sql`SELECT * FROM affiliate_products ORDER BY created_at DESC LIMIT 200`;
      return res.status(200).json({ products: rows });
    }
    if (req.method === 'POST') {
      if (!requireAdmin(req,res)) return;
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      if (!body.name || !body.product_url) return res.status(400).json({ error: 'name and product_url are required' });
      const rows = await sql`INSERT INTO affiliate_products
        (platform, product_id, name, product_url, affiliate_url, price, commission_rate, rating, orders, category)
        VALUES (${body.platform || 'shopee'}, ${body.product_id || null}, ${body.name}, ${body.product_url}, ${body.affiliate_url || null},
        ${Number(body.price || 0)}, ${Number(body.commission_rate || 0)}, ${Number(body.rating || 0)}, ${Number(body.orders || 0)}, ${body.category || null})
        RETURNING *`;
      return res.status(201).json({ product: rows[0] });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) { console.error(e); return res.status(500).json({ error: e.message }); }
};

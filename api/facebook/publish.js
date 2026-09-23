const { ensureSchema } = require('../../lib/db');

module.exports = async (req, res) => {
  try {
    const sql = await ensureSchema();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const contentId = Number(body.content_id);
    const contentRows = await sql`SELECT c.*, p.name, p.affiliate_url, p.product_url FROM affiliate_content c JOIN affiliate_products p ON p.id=c.product_id WHERE c.id=${contentId}`;
    if (!contentRows[0]) return res.status(404).json({ error: 'Content not found' });
    if (!process.env.FB_PAGE_ID || !process.env.FB_PAGE_ACCESS_TOKEN) return res.status(500).json({ error: 'FB_PAGE_ID / FB_PAGE_ACCESS_TOKEN are not configured' });
    const c = contentRows[0];
    const message = c.caption || `${c.hook || c.name}\n\n${c.affiliate_url || c.product_url}`;
    const params = new URLSearchParams({ message, link: c.affiliate_url || c.product_url, access_token: process.env.FB_PAGE_ACCESS_TOKEN });
    const r = await fetch(`https://graph.facebook.com/v24.0/${process.env.FB_PAGE_ID}/feed`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error?.message || `Facebook error ${r.status}`);
    await sql`UPDATE affiliate_content SET status='published', facebook_post_id=${data.id}, published_at=NOW() WHERE id=${contentId}`;
    return res.status(200).json({ ok: true, post_id: data.id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
};

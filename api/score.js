const { ensureSchema } = require('../lib/db');

async function scoreProduct(product) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
  const prompt = `Bạn là chuyên gia affiliate tại Việt Nam. Chấm điểm sản phẩm từ 0-100 để quảng bá trên Facebook. Dữ liệu: tên=${product.name}; giá=${product.price}; hoa hồng=${product.commission_rate}%; rating=${product.rating}; đơn=${product.orders}; ngành=${product.category || ''}. Trả JSON duy nhất: {"score":number,"reason":"ngắn gọn","decision":"TEST|HOLD|STOP"}. Ưu tiên khả năng bán, hoa hồng thực tế và khả năng làm content.`;
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-5.6-mini', temperature: 0.2, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] })
  });
  if (!r.ok) throw new Error(`OpenAI error ${r.status}: ${await r.text()}`);
  return JSON.parse((await r.json()).choices[0].message.content);
}

module.exports = async (req, res) => {
  try {
    const sql = await ensureSchema();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const id = Number(body.id);
    if (!id) return res.status(400).json({ error: 'id is required' });
    const rows = await sql`SELECT * FROM affiliate_products WHERE id=${id}`;
    if (!rows[0]) return res.status(404).json({ error: 'Product not found' });
    const result = await scoreProduct(rows[0]);
    const updated = await sql`UPDATE affiliate_products SET score=${result.score}, ai_reason=${result.reason}, status=${result.decision.toLowerCase()}, updated_at=NOW() WHERE id=${id} RETURNING *`;
    return res.status(200).json({ product: updated[0], ai: result });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
};

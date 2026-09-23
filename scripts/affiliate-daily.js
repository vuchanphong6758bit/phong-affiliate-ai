const { ensureSchema } = require('../lib/db');

async function aiJson(prompt) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', { method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.OPENAI_API_KEY}`}, body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-5.6-mini',temperature:.4,response_format:{type:'json_object'},messages:[{role:'user',content:prompt}]}) });
  if(!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
  return JSON.parse((await r.json()).choices[0].message.content);
}

async function main(){
  if(!process.env.DATABASE_URL || !process.env.OPENAI_API_KEY) throw new Error('DATABASE_URL and OPENAI_API_KEY are required');
  const sql=await ensureSchema();
  const products=await sql`SELECT * FROM affiliate_products WHERE status IN ('new','hold') ORDER BY created_at ASC LIMIT 10`;
  for(const p of products){
    const score=await aiJson(`Chấm điểm sản phẩm affiliate Facebook Việt Nam từ 0-100. Dữ liệu: tên=${p.name}; giá=${p.price}; hoa hồng=${p.commission_rate}%; rating=${p.rating}; đơn=${p.orders}; ngành=${p.category||''}. Trả JSON {"score":number,"decision":"TEST|HOLD|STOP","reason":"ngắn gọn"}. Không bịa dữ liệu.`);
    await sql`UPDATE affiliate_products SET score=${score.score}, ai_reason=${score.reason}, status=${score.decision.toLowerCase()}, updated_at=NOW() WHERE id=${p.id}`;
    if(score.decision==='TEST'){
      const c=await aiJson(`Viết content affiliate Facebook bằng tiếng Việt cho sản phẩm ${p.name}. Giá ${p.price}, rating ${p.rating}, đã bán ${p.orders}, hoa hồng ${p.commission_rate}%, link ${p.affiliate_url||p.product_url}. Trả JSON {"hook":"","script":"kịch bản video 30 giây","caption":"caption","cta":""}. Không phóng đại, không cam kết kết quả, không bịa thông số.`);
      await sql`INSERT INTO affiliate_content(product_id,hook,script,caption) VALUES(${p.id},${c.hook},${c.script},${c.caption})`;
    }
  }
  console.log(`Processed ${products.length} products`);
}
main().catch(e=>{console.error(e);process.exit(1)});

#!/usr/bin/env python3
import json, os, urllib.request, urllib.error
from datetime import datetime, timezone

MODEL = os.getenv('GEMINI_MODEL', 'gemini-2.5-flash')
OUT = 'test-output.json'

PRODUCTS = [
    {"id":"TEST-001","name":"Bình giữ nhiệt 500ml","category":"Gia dụng","price":159000,"commission_rate":0.12,"estimated_orders_per_1000_views":5.0,"trend":82},
    {"id":"TEST-002","name":"Đèn ngủ cảm biến","category":"Nhà cửa","price":99000,"commission_rate":0.10,"estimated_orders_per_1000_views":4.2,"trend":78},
    {"id":"TEST-003","name":"Máy xay mini cầm tay","category":"Nhà bếp","price":189000,"commission_rate":0.15,"estimated_orders_per_1000_views":4.6,"trend":86},
    {"id":"TEST-004","name":"Giá đỡ điện thoại để bàn","category":"Phụ kiện","price":79000,"commission_rate":0.08,"estimated_orders_per_1000_views":3.8,"trend":74},
    {"id":"TEST-005","name":"Hộp đựng thực phẩm chia ngăn","category":"Gia dụng","price":129000,"commission_rate":0.13,"estimated_orders_per_1000_views":4.4,"trend":80},
]


def call_gemini(prompt):
    key=os.getenv('GEMINI_API_KEY','').strip()
    if not key:
        return None, 'GEMINI_API_KEY chưa được cấu hình; dùng content template miễn phí để kiểm tra pipeline.'
    url=f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent'
    body={"contents":[{"parts":[{"text":prompt}]}],"generationConfig":{"temperature":0.6,"responseMimeType":"application/json"}}
    req=urllib.request.Request(url,data=json.dumps(body).encode(),headers={'Content-Type':'application/json','x-goog-api-key':key},method='POST')
    try:
        with urllib.request.urlopen(req,timeout=60) as r:
            d=json.loads(r.read().decode())
        text=d['candidates'][0]['content']['parts'][0]['text'].strip()
        if text.startswith('```'):
            text=text.split('\n',1)[1].rsplit('```',1)[0]
        return json.loads(text), None
    except Exception as e:
        return None, f'Gemini fallback: {e}'


def score(p):
    commission=p['price']*p['commission_rate']
    profit_per_order=commission-30000
    return 0.35*max(profit_per_order,0)/max(1,70000)+0.25*p['estimated_orders_per_1000_views']/5+0.20*p['trend']/100+0.20*p['commission_rate']/0.15

ranked=sorted(PRODUCTS,key=score,reverse=True)
chosen=ranked[0]
expected_views=1000
expected_orders=round(expected_views*chosen['estimated_orders_per_1000_views']/1000,2)
commission=expected_orders*chosen['price']*chosen['commission_rate']
ad_cost=expected_orders*30000
profit=commission-ad_cost

prompt=f'''Viết một bài affiliate ngắn bằng tiếng Việt cho sản phẩm {chosen['name']} giá {chosen['price']:,}đ, hoa hồng giả lập {chosen['commission_rate']*100:.1f}%.
Đây là DRY RUN, không đăng thật. Mục tiêu là hook rõ, lợi ích cụ thể, không bịa review/số liệu, không gây hiểu lầm.
Trả JSON gồm title, hook, body, cta, 3_test_variants.'''
ai, warning=call_gemini(prompt)
if not ai:
    ai={"title":f"Có đáng mua {chosen['name']} không?","hook":"Một món nhỏ nhưng có thể giải quyết một vấn đề rất thường gặp.","body":f"{chosen['name']} có mức giá thử nghiệm {chosen['price']:,}đ. Hãy kiểm tra giá và ưu đãi thực tế trên Lazada trước khi mua.","cta":"Xem ưu đãi và thông tin sản phẩm.","3_test_variants":["Tập trung vào vấn đề","Tập trung vào giá trị","Tập trung vào tình huống sử dụng"]}

result={
  "mode":"FREE_DRY_RUN",
  "generated_at":datetime.now(timezone.utc).isoformat(),
  "market_source":"mock dataset; no real ads/orders and no Lazada API calls",
  "ranked_products":[{"id":p['id'],"name":p['name'],"score":round(score(p),4),"estimated_commission_per_order":round(p['price']*p['commission_rate'])} for p in ranked],
  "selected_product":chosen,
  "simulation":{"views":expected_views,"orders":expected_orders,"conversion_rate":round(expected_orders/expected_views*100,3),"commission_vnd":round(commission),"facebook_ad_cost_vnd":round(ad_cost),"profit_vnd":round(profit)},
  "content":ai,
  "warning":warning,
  "next_step":"Replace mock products with official Lazada API/feed after Open Platform approval; keep LIVE_MODE disabled until API and tracking are verified."
}
open(OUT,'w',encoding='utf-8').write(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps(result,ensure_ascii=False,indent=2))

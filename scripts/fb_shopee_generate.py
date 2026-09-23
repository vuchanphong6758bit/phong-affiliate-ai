import csv, json, os, requests
from pathlib import Path

file_path = os.environ.get('PRODUCTS_FILE', 'data/shopee-products.csv')
rows = list(csv.DictReader(open(file_path, encoding='utf-8-sig')))
ready = [r for r in rows if (r.get('status') or '').upper() == 'READY' and r.get('affiliate_url')]
if not ready:
    raise SystemExit('No READY Shopee products with affiliate_url.')

def score(r):
    try: price=float(r.get('price') or 0); commission=float(r.get('commission_pct') or 0); rating=float(r.get('rating') or 0); orders=float(r.get('orders') or 0)
    except ValueError: return 0
    order_score=min(25, orders/1000*25)
    rating_score=max(0, min(20, (rating/5)*20))
    commission_score=min(30, commission*2)
    price_score=15 if 50000 <= price <= 1000000 else 8
    return round(order_score+rating_score+commission_score+price_score, 1)

product=max(ready, key=score)
product_score=score(product)

prompt=f'''Bạn là chuyên gia affiliate Facebook tại Việt Nam. Viết 1 bài Facebook ngắn, tự nhiên, không phóng đại cho sản phẩm Shopee sau:
Tên: {product['product_name']}
Giá: {product['price']}
Đánh giá: {product['rating']}
Đã bán: {product['orders']}
Ngành: {product['category']}

Yêu cầu: hook 1 câu, 3 lợi ích thực tế, CTA rõ ràng. Không nói chắc chắn về hiệu quả nếu dữ liệu không chứng minh. Trả về JSON với trường message.'''

resp=requests.post('https://generativelanguage.googleapis.com/v1beta/models/'+os.environ['GEMINI_MODEL']+':generateContent',params={'key':os.environ['GEMINI_API_KEY']},json={'contents':[{'parts':[{'text':prompt}]}]},timeout=60)
resp.raise_for_status()
text=resp.json()['candidates'][0]['content']['parts'][0]['text'].strip()
if text.startswith('```'):
    text=text.split('\n',1)[1].rsplit('```',1)[0]
data=json.loads(text)
message=data['message']

out=os.environ.get('GITHUB_OUTPUT')
with open(out,'a',encoding='utf-8') as f:
    f.write(f"product_id={product['product_id']}\n")
    f.write(f"product_name={product['product_name']}\n")
    f.write(f"score={product_score}\n")
    f.write(f"affiliate_url={product['affiliate_url']}\n")
    f.write('message<<EOF\n'+message+'\nEOF\n')

import csv, json, os, requests, time, hashlib

file_path = os.environ.get('PRODUCTS_FILE', 'data/shopee-products.csv')
rows = list(csv.DictReader(open(file_path, encoding='utf-8-sig')))
ready = [r for r in rows if (r.get('status') or '').upper() == 'READY' and (r.get('affiliate_url') or r.get('product_url'))]
if not ready:
    raise SystemExit('No READY Shopee products with product_url/affiliate_url.')

def num(value):
    text=str(value or '').strip().replace(',', '')
    if text.endswith('+'):
        text=text[:-1]
    try:
        return float(text or 0)
    except ValueError:
        return 0.0

def score(r):
    price=num(r.get('price'))
    commission=num(r.get('commission_pct'))
    rating=num(r.get('rating'))
    orders=num(r.get('orders'))
    order_score=min(25, orders/1000*25)
    rating_score=max(0, min(20, (rating/5)*20))
    # Missing commission data is not treated as a zero-commission product.
    commission_score=min(30, commission*2) if commission > 0 else 10
    price_score=15 if 50000 <= price <= 1000000 else 8
    return round(order_score+rating_score+commission_score+price_score, 1)

product=max(ready, key=score)
product_score=score(product)

affiliate_url=(product.get('affiliate_url') or '').strip()
if not affiliate_url:
    app_id=os.environ.get('SHOPEE_API_APP_ID','').strip()
    secret=os.environ.get('SHOPEE_API_SECRET','').strip()
    origin=(product.get('product_url') or '').strip()
    if not app_id or not secret:
        raise SystemExit('MISSING_SECRET: SHOPEE_API_APP_ID and SHOPEE_API_SECRET are required to generate the affiliate link automatically.')
    if not origin:
        raise SystemExit('Product has no product_url.')
    query='mutation { generateShortLink(input: { originUrl: '+json.dumps(origin)+', subIds: ["facebook","ai"] }) { shortLink } }'
    payload=json.dumps({'query':query}, separators=(',',':'))
    timestamp=int(time.time())
    signature=hashlib.sha256(f'{app_id}{timestamp}{payload}{secret}'.encode()).hexdigest()
    auth=f'SHA256 Credential={app_id}, Timestamp={timestamp}, Signature={signature}'
    resp=requests.post('https://open-api.affiliate.shopee.vn/graphql',headers={'Authorization':auth,'Content-Type':'application/json'},data=payload,timeout=60)
    resp.raise_for_status()
    body=resp.json()
    try:
        affiliate_url=body['data']['generateShortLink']['shortLink']
    except Exception:
        raise SystemExit(f'Shopee affiliate link generation failed: {json.dumps(body, ensure_ascii=False)}')
    if not affiliate_url:
        raise SystemExit('Shopee returned an empty affiliate short link.')

prompt=f'''Bạn là người làm affiliate Facebook tại Việt Nam, ưu tiên tỷ lệ click và mua hàng nhưng tuyệt đối không spam.
Viết 1 bài đăng có cảm giác như người thật đang chia sẻ một món đáng thử, không phải quảng cáo máy móc.

Sản phẩm:
Tên: {product['product_name']}
Giá tham khảo: {product['price'] or 'chưa có dữ liệu'}
Đánh giá: {product['rating'] or 'chưa có dữ liệu'}
Đã bán: {product['orders'] or 'chưa có dữ liệu'}
Ngành: {product['category'] or 'chưa có dữ liệu'}

Yêu cầu:
- Mở đầu bằng 1 hook ngắn, tạo tò mò.
- Bố cục thoáng, 5-8 dòng ngắn, có bullet/emoji vừa phải để dễ quét trên Facebook.
- Nêu 2-3 điểm đáng chú ý dựa CHỈ trên dữ liệu được cung cấp; nếu thiếu dữ liệu thì nói theo hướng trải nghiệm/khám phá, không bịa tính năng.
- Có một câu hỏi tự nhiên để kích thích bình luận.
- CTA rõ ràng nhưng không giật tít.
- Cuối bài đặt đúng link affiliate, không dùng placeholder.
- Không dùng các câu như 'chắc chắn tốt nhất', 'cam kết', '100%'.
- Không nhồi hashtag; tối đa 3 hashtag liên quan.
- Trả JSON duy nhất với trường message.'''

resp=requests.post('https://generativelanguage.googleapis.com/v1beta/models/'+os.environ['GEMINI_MODEL']+':generateContent',params={'key':os.environ['GEMINI_API_KEY']},json={'contents':[{'parts':[{'text':prompt}]}]},timeout=60)
resp.raise_for_status()
text=resp.json()['candidates'][0]['content']['parts'][0]['text'].strip()
if text.startswith('```'):
    text=text.split('\n',1)[1].rsplit('```',1)[0]
data=json.loads(text)
message=data['message']
placeholders = ('[Chèn link affiliate của bạn]', '[LINK AFFILIATE]', '[link affiliate]', '<affiliate_url>', '[Link affiliate của bạn]')
for placeholder in placeholders:
    message = message.replace(placeholder, affiliate_url)
if affiliate_url not in message:
    message = message.rstrip() + '\n\nXem sản phẩm: ' + affiliate_url

out=os.environ.get('GITHUB_OUTPUT')
with open(out,'a',encoding='utf-8') as f:
    f.write(f"product_id={product['product_id']}\n")
    f.write(f"product_name={product['product_name']}\n")
    f.write(f"score={product_score}\n")
    f.write(f"affiliate_url={affiliate_url}\n")
    f.write('message<<EOF\n'+message+'\nEOF\n')

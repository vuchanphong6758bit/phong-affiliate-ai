import csv, json, os, requests, time, hashlib

file_path = os.environ.get('PRODUCTS_FILE', 'data/shopee-products.csv')
rows = list(csv.DictReader(open(file_path, encoding='utf-8-sig')))
ready = [r for r in rows if (r.get('status') or '').upper() == 'READY' and (r.get('affiliate_url') or r.get('product_url'))]
if not ready:
    raise SystemExit('No READY Shopee products with product_url/affiliate_url.')

def num(value):
    text=str(value or '').strip().replace(',', '')
    if text.endswith('+'): text=text[:-1]
    try: return float(text or 0)
    except ValueError: return 0.0

def load_learning():
    path='data/learning/facebook-learning.json'
    try: return json.load(open(path,encoding='utf-8'))
    except Exception: return {}

learning=load_learning()
top={str(x.get('product_id')):x for x in learning.get('top_products',[])}

def score(r):
    price=num(r.get('price'))
    commission=num(r.get('commission_pct'))
    rating=num(r.get('rating'))
    orders=num(r.get('orders'))
    order_score=min(25, orders/1000*25)
    rating_score=max(0, min(20, (rating/5)*20))
    commission_score=min(30, commission*2) if commission > 0 else 10
    price_score=15 if 50000 <= price <= 1000000 else 8
    base=order_score+rating_score+commission_score+price_score
    observed=top.get(str(r.get('product_id')), {})
    # Once real Facebook data exists, behavior gets more weight than static metadata.
    clicks=float(observed.get('clicks') or 0)
    impressions=float(observed.get('impressions') or 0)
    ctr=float(observed.get('ctr') or 0)
    learning_bonus=min(25, clicks*2 + ctr*100*10) if impressions else 0
    return round(base+learning_bonus,1)

# Avoid posting the same product repeatedly while still exploiting proven winners.
recent_path='data/runs'
recent=[]
try:
    for fn in sorted(os.listdir(recent_path))[-7:]:
        if fn.endswith('.json'):
            d=json.load(open(os.path.join(recent_path,fn),encoding='utf-8'))
            recent.append(str(d.get('product_id') or ''))
except Exception: pass

ranked=sorted(ready,key=score,reverse=True)
if len(ranked)>1:
    non_recent=[r for r in ranked if r.get('product_id') not in recent]
    product=(non_recent or ranked)[0]
else:
    product=ranked[0]
product_score=score(product)

affiliate_url=(product.get('affiliate_url') or '').strip()
if not affiliate_url:
    app_id=os.environ.get('SHOPEE_API_APP_ID','').strip()
    secret=os.environ.get('SHOPEE_API_SECRET','').strip()
    origin=(product.get('product_url') or '').strip()
    if not app_id or not secret:
        raise SystemExit('MISSING_SECRET: SHOPEE_API_APP_ID and SHOPEE_API_SECRET are required to generate the affiliate link automatically.')
    if not origin: raise SystemExit('Product has no product_url.')
    query='mutation { generateShortLink(input: { originUrl: '+json.dumps(origin)+', subIds: ["facebook","ai"] }) { shortLink } }'
    payload=json.dumps({'query':query},separators=(',',':'))
    timestamp=int(time.time())
    signature=hashlib.sha256(f'{app_id}{timestamp}{payload}{secret}'.encode()).hexdigest()
    auth=f'SHA256 Credential={app_id}, Timestamp={timestamp}, Signature={signature}'
    resp=requests.post('https://open-api.affiliate.shopee.vn/graphql',headers={'Authorization':auth,'Content-Type':'application/json'},data=payload,timeout=60)
    resp.raise_for_status()
    body=resp.json()
    try: affiliate_url=body['data']['generateShortLink']['shortLink']
    except Exception: raise SystemExit(f'Shopee affiliate link generation failed: {json.dumps(body, ensure_ascii=False)}')
    if not affiliate_url: raise SystemExit('Shopee returned an empty affiliate short link.')

observed=top.get(str(product.get('product_id')), {})
prompt=f'''Bạn là người xây Page Facebook affiliate mới tại Việt Nam trong chiến dịch 30 ngày đầu.
Mục tiêu kép: xây dựng người xem/tương tác thật và tạo hoa hồng thật. Tuyệt đối không spam, không thao túng tương tác, không bịa dữ liệu.

Sản phẩm:
Tên: {product.get('product_name','')}
Giá: {product.get('price') or 'chưa có dữ liệu'}
Đánh giá: {product.get('rating') or 'chưa có dữ liệu'}
Đã bán: {product.get('orders') or 'chưa có dữ liệu'}
Ngành: {product.get('category') or 'chưa có dữ liệu'}

Tín hiệu học được từ các bài trước (có thể chưa có dữ liệu): {json.dumps(observed,ensure_ascii=False)}

Chọn 1 góc nội dung tự nhiên, luân phiên giữa: khám phá, vấn đề→giải pháp, checklist, so sánh, deal đáng chú ý, trải nghiệm/quan sát. Không biến mọi bài thành quảng cáo.
Yêu cầu:
- Hook 1-2 dòng đầu thật cụ thể, không giật tít sai sự thật.
- 6-10 dòng ngắn, dễ đọc trên điện thoại.
- Ưu tiên lợi ích/nhu cầu thực tế; chỉ dùng thông tin sản phẩm được cung cấp.
- Có 1 câu hỏi tự nhiên để khuyến khích bình luận, nhưng không kêu gọi tương tác giả.
- CTA mềm, minh bạch rằng đây là link affiliate nếu cần.
- Cuối bài đặt đúng link affiliate.
- Tối đa 3 hashtag.
- Không dùng '100%', 'tốt nhất', 'cam kết', 'chắc chắn'.
- Không đưa thông tin y tế/tài chính sai lệch.
- Trả JSON duy nhất: {{"message":"..."}}'''

resp=requests.post('https://generativelanguage.googleapis.com/v1beta/models/'+os.environ['GEMINI_MODEL']+':generateContent',params={'key':os.environ['GEMINI_API_KEY']},json={'contents':[{'parts':[{'text':prompt}]}]},timeout=60)
resp.raise_for_status()
text=resp.json()['candidates'][0]['content']['parts'][0]['text'].strip()
if text.startswith('```'): text=text.split('\n',1)[1].rsplit('```',1)[0]
data=json.loads(text)
message=data['message']
placeholders=('[Chèn link affiliate của bạn]','[LINK AFFILIATE]','[link affiliate]','<affiliate_url>','[Link affiliate của bạn]')
for placeholder in placeholders: message=message.replace(placeholder,affiliate_url)
if affiliate_url not in message: message=message.rstrip()+'\n\nXem sản phẩm: '+affiliate_url

out=os.environ.get('GITHUB_OUTPUT')
with open(out,'a',encoding='utf-8') as f:
    f.write(f"product_id={product['product_id']}\n")
    f.write(f"product_name={product['product_name']}\n")
    f.write(f"score={product_score}\n")
    f.write(f"affiliate_url={affiliate_url}\n")
    f.write('message<<EOF\n'+message+'\nEOF\n')

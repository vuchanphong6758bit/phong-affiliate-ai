#!/usr/bin/env python3
import csv, io, json, os, re, sys, time, urllib.parse, urllib.request, urllib.error
from datetime import datetime, timezone

SHEET_ID = os.environ.get('GOOGLE_SHEET_ID', '1LUM9KJtQLdfBYWCxKf0Q_VV5TvfnSG2ZtpH-M_3W_20')
MODEL = os.environ.get('GEMINI_MODEL', 'gemini-2.5-flash')

TAB_IDS = {
    'ACCOUNTS': '439852849',
    'SETTINGS': '1107128653',
    'CONTENT': '1781613104',
    'PRODUCTS': '1931547870',
}

BLOCKED_NAMES = {
    'sản phẩm mẫu', 'san pham mau', 'sample product', 'test product',
    'demo product', 'placeholder', 'sản phẩm test', 'product test'
}
BLOCKED_STATUS = {'inactive', 'disabled', 'off', 'false', '0', 'ngừng', 'không'}


def norm(v):
    return re.sub(r'[^a-z0-9]', '', str(v or '').strip().lower())


def rowdicts(values):
    if not values:
        return []
    headers = values[0]
    out = []
    for row in values[1:]:
        d = {}
        for i, h in enumerate(headers):
            d[str(h).strip()] = row[i] if i < len(row) else ''
        out.append(d)
    return out


def pick(d, *names):
    nd = {norm(k): v for k, v in d.items()}
    for n in names:
        if norm(n) in nd and str(nd[norm(n)]).strip() != '':
            return str(nd[norm(n)]).strip()
    return ''


def fetch_public_csv(gid):
    url = f'https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={gid}'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'PFAI/1.0'})
        with urllib.request.urlopen(req, timeout=30) as r:
            return list(csv.reader(io.TextIOWrapper(r, encoding='utf-8')))
    except Exception:
        return None


def google_auth():
    raw = os.environ.get('GOOGLE_SERVICE_ACCOUNT_JSON', '').strip()
    if not raw:
        return None
    try:
        from google.oauth2 import service_account
        from google.auth.transport.requests import AuthorizedSession
    except Exception as e:
        raise RuntimeError(f'Google auth packages missing: {e}')
    info = json.loads(raw)
    creds = service_account.Credentials.from_service_account_info(
        info,
        scopes=['https://www.googleapis.com/auth/spreadsheets'],
    )
    return AuthorizedSession(creds)


def sheets_values(session, tab_name, gid):
    if session:
        rng = urllib.parse.quote(f"'{tab_name}'!A:ZZ", safe='')
        url = f'https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{rng}?majorDimension=ROWS'
        r = session.get(url, timeout=30)
        r.raise_for_status()
        return r.json().get('values', [])
    return fetch_public_csv(gid) or []


def sheet_title_from_gid(session, gid, fallback):
    if not session:
        return fallback
    url = f'https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}?fields=sheets.properties'
    r = session.get(url, timeout=30)
    r.raise_for_status()
    for s in r.json().get('sheets', []):
        p = s.get('properties', {})
        if str(p.get('sheetId')) == str(gid):
            return p.get('title', fallback)
    return fallback


def append_row(session, tab_name, values):
    if not session:
        print('WARNING: no Google write credential; row will not be persisted.', file=sys.stderr)
        return
    rng = urllib.parse.quote(f"'{tab_name}'!A:ZZ", safe='')
    url = f'https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{rng}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS'
    r = session.post(url, json={'values': [values]}, timeout=30)
    r.raise_for_status()


def update_content_row(session, tab_name, content_id, updates):
    if not session:
        return
    values = sheets_values(session, tab_name, TAB_IDS['CONTENT'])
    if not values:
        return
    headers = values[0]
    idx = None
    for i, row in enumerate(values[1:], start=2):
        d = {str(headers[j]).strip(): (row[j] if j < len(row) else '') for j in range(len(headers))}
        if pick(d, 'Content_ID', 'Content ID', 'ContentID') == content_id:
            idx = i
            break
    if idx is None:
        return
    header_index = {norm(h): i for i, h in enumerate(headers)}
    row = list(values[idx - 1]) if idx - 1 < len(values) else []
    row = row + [''] * (len(headers) - len(row))
    for key, val in updates.items():
        k = norm(key)
        if k in header_index:
            row[header_index[k]] = val
    rng = urllib.parse.quote(f"'{tab_name}'!A{idx}:ZZ{idx}", safe='')
    url = f'https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{rng}?valueInputOption=USER_ENTERED'
    r = session.put(url, json={'range': f"{tab_name}!A{idx}", 'majorDimension': 'ROWS', 'values': [row]}, timeout=30)
    r.raise_for_status()


def is_http_url(value):
    try:
        u = urllib.parse.urlparse(str(value or '').strip())
        return u.scheme in {'http', 'https'} and bool(u.netloc)
    except Exception:
        return False


def is_tiktok_url(value):
    if not is_http_url(value):
        return False
    host = urllib.parse.urlparse(value).netloc.lower().split(':')[0]
    return host == 'tiktok.com' or host.endswith('.tiktok.com') or host == 'vt.tiktok.com'


def gemini(prompt, attempts=2):
    key = os.environ.get('GEMINI_API_KEY', '').strip()
    if not key:
        raise RuntimeError('GEMINI_API_KEY is not configured in GitHub Secrets.')
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent'
    body = {
        'contents': [{'parts': [{'text': prompt}]}],
        'tools': [{'google_search': {}}],
        'generationConfig': {'temperature': 0.5, 'responseMimeType': 'application/json'},
    }
    last_error = None
    for attempt in range(attempts):
        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode(),
            headers={'Content-Type': 'application/json', 'x-goog-api-key': key},
            method='POST',
        )
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                data = json.loads(r.read().decode())
            text = data['candidates'][0]['content']['parts'][0]['text'].strip()
            if text.startswith('```'):
                text = re.sub(r'^```(?:json)?\s*', '', text)
                text = re.sub(r'\s*```$', '', text)
            return json.loads(text)
        except (urllib.error.HTTPError, KeyError, IndexError, json.JSONDecodeError, TypeError) as e:
            last_error = e
            if isinstance(e, urllib.error.HTTPError):
                detail = e.read().decode(errors='replace')
                last_error = RuntimeError(f'Gemini HTTP {e.code}: {detail[:1000]}')
            time.sleep(2)
    raise RuntimeError(f'Gemini failed after retries: {last_error}')


def valid_product_rows(products):
    out = []
    for p in products:
        name = pick(p, 'Product', 'Product_Name', 'Product Name', 'Tên sản phẩm', 'Name')
        pid = pick(p, 'Product_ID', 'Product ID', 'ProductID')
        link = pick(p, 'Affiliate_Link', 'Affiliate Link', 'Product_URL', 'Product URL', 'Link', 'URL', 'TikTok Shop URL')
        image = pick(p, 'Image_URL', 'Image URL', 'Product_Image', 'Image')
        status = pick(p, 'Status', 'Active', 'Trạng thái').lower()
        if not pid or not name or name.strip().lower() in BLOCKED_NAMES:
            continue
        if status in BLOCKED_STATUS or not link or not is_http_url(link):
            continue
        out.append((p, name, pid, link, image))
    return out


def discover_market_candidates(existing, today):
    existing_text = []
    for _, name, pid, link, _ in existing[:40]:
        existing_text.append(f'- {pid} | {name} | {link}')
    existing_block = '\n'.join(existing_text) if existing_text else '(Chưa có sản phẩm hợp lệ trong PRODUCTS)'

    prompt = f'''Bạn là bộ phận Product Scout cho hệ thống affiliate TikTok Shop tại Việt Nam.
Ngày hiện tại: {today}.

Mục tiêu: MỖI NGÀY tìm ra các sản phẩm có xác suất bán tốt và đáng làm video affiliate, không chọn sản phẩm chỉ vì đang nổi tiếng.
Hãy dùng Google Search để nghiên cứu tín hiệu thị trường hiện tại, ưu tiên nguồn TikTok Shop Việt Nam và nguồn thị trường uy tín.

Theo hướng dẫn TikTok Shop Việt Nam, khi chọn sản phẩm cần quan tâm chất lượng sản phẩm, đánh giá sản phẩm/người bán, giá, deal và hoa hồng; các tín hiệu cơ hội gồm nhu cầu cao, nguồn cung thấp, bán chạy, lượt quan tâm cao, đang trend trên TikTok và từ khóa tăng nhanh.

Danh sách sản phẩm hiện có:
{existing_block}

Hãy:
1. Phân tích nhu cầu mua sắm hiện tại ở Việt Nam và các chủ đề đang tăng.
2. Tìm 5-8 sản phẩm cụ thể có thể quảng bá trên TikTok Shop.
3. Ưu tiên sản phẩm giải quyết nhu cầu rõ ràng, dễ trình bày bằng video 20-45 giây, giá dễ mua, có dấu hiệu nhu cầu thật và có thể tạo hook tốt.
4. Không bịa số liệu, giá, rating, doanh số hoặc hoa hồng. Nếu không xác minh được thì để null.
5. product_url phải là URL TikTok Shop thực tế có thể mở được; không dùng URL tìm kiếm, URL bài báo, URL giả hoặc URL tự chế.
6. Nếu sản phẩm đã có trong danh sách hiện có, giữ nguyên product_id và product_url hiện có.
7. Không chọn sản phẩm bị cấm/hạn chế rõ ràng hoặc có rủi ro chính sách cao.

Trả về DUY NHẤT JSON:
{{
  "market_summary": "...",
  "keywords": ["..."],
  "candidates": [
    {{
      "product_id": "existing ID hoặc NEW-1",
      "product_name": "...",
      "category": "...",
      "product_url": "https://...",
      "image_url": null,
      "price_vnd": null,
      "commission_rate": null,
      "rating": null,
      "review_count": null,
      "sold_count": null,
      "demand_signal": "...",
      "trend_signal": "...",
      "why_now": "...",
      "risk": "...",
      "score": 0
    }}
  ]
}}

Chấm score 0-100 theo: nhu cầu hiện tại 30%, xu hướng/tăng trưởng 20%, giá/deal 15%, chất lượng/tín nhiệm 15%, khả năng làm video 10%, khả năng kiếm hoa hồng 10%. Không có dữ liệu thì không được tự bịa; giảm điểm thay vì đoán.
'''
    data = gemini(prompt, attempts=2)
    candidates = data.get('candidates') if isinstance(data, dict) else None
    if not isinstance(candidates, list):
        raise RuntimeError('PRODUCT_SCOUT_INVALID: Gemini không trả về candidates hợp lệ.')
    clean = []
    for c in candidates:
        if not isinstance(c, dict):
            continue
        name = str(c.get('product_name') or '').strip()
        url = str(c.get('product_url') or '').strip()
        if not name or name.lower() in BLOCKED_NAMES or not is_tiktok_url(url):
            continue
        try:
            score = max(0, min(100, float(c.get('score') or 0)))
        except Exception:
            score = 0
        c['score'] = score
        clean.append(c)
    clean.sort(key=lambda x: x['score'], reverse=True)
    if not clean:
        raise RuntimeError('NO_MARKET_PRODUCT: AI không tìm được URL TikTok Shop hợp lệ từ nguồn web.')
    return data, clean


def save_discovered_product(session, products_tab, headers, candidate):
    existing_id = str(candidate.get('product_id') or '').strip()
    if existing_id and not existing_id.upper().startswith('NEW-'):
        return existing_id
    date_key = datetime.now(timezone.utc).strftime('%Y%m%d')
    pid = f"DISC-{date_key}-{abs(hash(candidate.get('product_name',''))) % 10000:04d}"
    rowmap = {
        'Product_ID': pid,
        'Product': candidate.get('product_name', ''),
        'Product_Name': candidate.get('product_name', ''),
        'Name': candidate.get('product_name', ''),
        'Category': candidate.get('category', ''),
        'Affiliate_Link': candidate.get('product_url', ''),
        'Affiliate Link': candidate.get('product_url', ''),
        'Product_URL': candidate.get('product_url', ''),
        'Product URL': candidate.get('product_url', ''),
        'TikTok Shop URL': candidate.get('product_url', ''),
        'Image_URL': candidate.get('image_url') or '',
        'Price_VND': candidate.get('price_vnd') or '',
        'Commission_Rate': candidate.get('commission_rate') or '',
        'Rating': candidate.get('rating') or '',
        'Review_Count': candidate.get('review_count') or '',
        'Sold_Count': candidate.get('sold_count') or '',
        'Market_Score': candidate.get('score') or '',
        'Market_Reason': candidate.get('why_now') or candidate.get('demand_signal') or '',
        'Trend_Signal': candidate.get('trend_signal') or '',
        'Discovered_Date': datetime.now(timezone.utc).strftime('%Y-%m-%d'),
        'Status': 'ACTIVE',
    }
    if headers:
        row = []
        for h in headers:
            value = ''
            for k, v in rowmap.items():
                if norm(k) == norm(h):
                    value = v
                    break
            row.append(value)
        append_row(session, products_tab, row)
    return pid


def main():
    session = google_auth()
    tabs = {}
    for name, gid in TAB_IDS.items():
        title = sheet_title_from_gid(session, gid, name)
        tabs[name] = (title, sheets_values(session, title, gid))

    accounts = rowdicts(tabs['ACCOUNTS'][1])
    products = rowdicts(tabs['PRODUCTS'][1])
    settings = rowdicts(tabs['SETTINGS'][1])

    existing = valid_product_rows(products)
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    market_data, candidates = discover_market_candidates(existing, today)
    top = candidates[0]

    # Prefer an existing product when the scout can match it. Otherwise add the best new discovery to PRODUCTS.
    by_id = {pid: item for item in existing for pid in [item[2]]}
    product_id = str(top.get('product_id') or '').strip()
    if product_id in by_id:
        p, product_name, product_id, product_link, image_url = by_id[product_id]
    else:
        product_link = str(top.get('product_url') or '').strip()
        product_name = str(top.get('product_name') or '').strip()
        image_url = str(top.get('image_url') or '').strip()
        products_tab, product_values = tabs['PRODUCTS']
        product_headers = product_values[0] if product_values else []
        product_id = save_discovered_product(session, products_tab, product_headers, top)
        p = top

    active_accounts = []
    for a in accounts:
        aid = pick(a, 'Account_ID', 'Account ID', 'AccountID')
        status = pick(a, 'Status', 'Active', 'Trạng thái').lower()
        if aid and status not in BLOCKED_STATUS:
            active_accounts.append((a, aid))
    if not active_accounts:
        raise RuntimeError('NO_ACTIVE_ACCOUNT: ACCOUNTS không có tài khoản hoạt động.')

    # Rotate accounts daily, but product selection is market-score driven rather than simple rotation.
    day_index = int(datetime.now(timezone.utc).strftime('%Y%m%d'))
    a, account_id = active_accounts[day_index % len(active_accounts)]
    mode = pick(a, 'Mode', 'TikTok_Mode', 'TikTok Mode') or os.environ.get('TIKTOK_MODE', 'sandbox')
    privacy = pick(a, 'Privacy_Level', 'Privacy Level', 'privacy_level') or os.environ.get('TIKTOK_PRIVACY_LEVEL', 'SELF_ONLY')
    duration = pick(p, 'Duration', 'Video_Duration', 'Video Duration') or str(top.get('duration') or '30')
    content_id = f"PFAI-{datetime.now().strftime('%Y%m%d-%H%M%S')}"

    prompt = f'''Bạn là AI Content Strategist cho affiliate TikTok Shop Việt Nam.
Ngày: {today}
Sản phẩm được chọn bởi Product Scout: {product_name}
Product_ID: {product_id}
TikTok Shop URL: {product_link}
Tín hiệu thị trường: {top.get('why_now','')}
Demand signal: {top.get('demand_signal','')}
Trend signal: {top.get('trend_signal','')}

Hãy dùng Google Search để kiểm tra lại thông tin quan trọng trước khi viết.
Tạo nội dung video 20-45 giây, tập trung vào một nhu cầu mua hàng cụ thể. Không bịa thông số, giá, công dụng, chứng nhận hay kết quả.

Trả về DUY NHẤT JSON với: title, hook, body, cta, image_url, duration, privacy_level, mode.
- title <= 120 ký tự.
- hook phải nêu pain point hoặc lợi ích có căn cứ.
- body 2-4 câu, nói rõ ai nên mua và điểm cần kiểm tra.
- cta ngắn, thúc đẩy xem sản phẩm.
- image_url giữ nguyên URL ảnh nếu có, nếu không để rỗng.
- duration số nguyên 20-45.
- privacy_level={privacy}; mode={mode}.
- Không trả WAIT.
'''
    content = gemini(prompt, attempts=2)
    required = ['title', 'hook', 'body', 'cta']
    if any(not str(content.get(k, '')).strip() for k in required):
        raise RuntimeError('AI_EMPTY_CONTENT: Gemini trả về nội dung rỗng.')
    content['image_url'] = content.get('image_url') or image_url
    content['duration'] = max(20, min(45, int(content.get('duration') or duration)))
    content['privacy_level'] = privacy
    content['mode'] = mode

    content_tab, content_values = tabs['CONTENT']
    headers = content_values[0] if content_values else []
    rowmap = {
        'Content_ID': content_id, 'Account_ID': account_id, 'Product_ID': product_id,
        'Product': product_name, 'Title': content['title'], 'Hook': content['hook'],
        'Body': content['body'], 'CTA': content['cta'], 'Image_URL': content['image_url'],
        'Duration': content['duration'], 'Privacy_Level': privacy, 'Mode': mode,
        'Video_Status': 'CONTENT_READY', 'Publish_Status': 'PENDING', 'Publish_Date': '',
        'Publish_ID': '', 'Post_ID': '', 'Error': '', 'Affiliate_Link': product_link,
        'Market_Score': top.get('score', ''), 'Market_Reason': top.get('why_now', ''),
        'Market_Summary': market_data.get('market_summary', '') if isinstance(market_data, dict) else '',
    }
    if headers:
        row = []
        for h in headers:
            value = ''
            for k, v in rowmap.items():
                if norm(k) == norm(h):
                    value = v
                    break
            row.append(value)
        append_row(session, content_tab, row)

    with open('/tmp/pfai_content.json', 'w', encoding='utf-8') as f:
        json.dump({
            'content_id': content_id, 'account_id': account_id, 'product_id': product_id,
            'product': product_name, 'affiliate_link': product_link,
            'market_score': top.get('score'), 'market_reason': top.get('why_now'),
            'market_summary': market_data.get('market_summary', '') if isinstance(market_data, dict) else '',
            'keywords': market_data.get('keywords', []) if isinstance(market_data, dict) else [],
            **content
        }, f, ensure_ascii=False)

    with open(os.environ.get('GITHUB_OUTPUT', '/tmp/pfai_outputs.txt'), 'a', encoding='utf-8') as out:
        output_values = {
            'content_id': content_id, 'account_id': account_id, 'product_id': product_id,
            'product': product_name, 'affiliate_link': product_link, 'title': content['title'],
            'hook': content['hook'], 'body': content['body'], 'cta': content['cta'],
            'image_url': content['image_url'], 'duration': content['duration'],
            'privacy_level': privacy, 'mode': mode, 'market_score': top.get('score', 0),
            'market_reason': top.get('why_now', ''), 'market_summary': market_data.get('market_summary', '') if isinstance(market_data, dict) else ''
        }
        for k, v in output_values.items():
            out.write(f'{k}={str(v).replace(chr(10), " ")}\n')

    print(json.dumps({
        'selected_account': account_id,
        'selected_product': product_id,
        'product': product_name,
        'content_id': content_id,
        'market_score': top.get('score'),
        'market_reason': top.get('why_now'),
        'keywords': market_data.get('keywords', []) if isinstance(market_data, dict) else [],
        'title': content['title'], 'mode': mode, 'privacy_level': privacy
    }, ensure_ascii=False))


if __name__ == '__main__':
    main()

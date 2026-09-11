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
        # Use numeric gid through the batchGet-by-dataFilter endpoint is more awkward;
        # the tab names are stable in the user's workbook, so use quoted tab names.
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
        print('WARNING: no Google write credential; CONTENT row will not be persisted.', file=sys.stderr)
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
    row = values[idx - 1] if idx - 1 < len(values) else []
    row = list(row) + [''] * (len(headers) - len(row))
    for key, val in updates.items():
        k = norm(key)
        if k in header_index:
            row[header_index[k]] = val
    start = urllib.parse.quote(f"'{tab_name}'!A{idx}", safe='')
    end = urllib.parse.quote(f"'{tab_name}'!{chr(64 + len(headers))}{idx}" if len(headers) <= 26 else f"'{tab_name}'!ZZ{idx}", safe='')
    # Use A:ZZ update to avoid column-letter assumptions.
    rng = urllib.parse.quote(f"'{tab_name}'!A{idx}:ZZ{idx}", safe='')
    url = f'https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{rng}?valueInputOption=USER_ENTERED'
    r = session.put(url, json={'range': f"{tab_name}!A{idx}", 'majorDimension': 'ROWS', 'values': [row]}, timeout=30)
    r.raise_for_status()


def gemini(prompt):
    key = os.environ.get('GEMINI_API_KEY', '').strip()
    if not key:
        raise RuntimeError('GEMINI_API_KEY is not configured in GitHub Secrets.')
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent'
    body = {
        'contents': [{'parts': [{'text': prompt}]}],
        'tools': [{'google_search': {}}],
        'generationConfig': {'temperature': 0.7, 'responseMimeType': 'application/json'},
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={'Content-Type': 'application/json', 'x-goog-api-key': key},
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            data = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors='replace')
        raise RuntimeError(f'Gemini HTTP {e.code}: {detail[:1000]}')
    text = data['candidates'][0]['content']['parts'][0]['text']
    text = text.strip()
    if text.startswith('```'):
        text = re.sub(r'^```(?:json)?\s*', '', text)
        text = re.sub(r'\s*```$', '', text)
    return json.loads(text)


def main():
    session = google_auth()
    tabs = {}
    for name, gid in TAB_IDS.items():
        title = sheet_title_from_gid(session, gid, name)
        tabs[name] = (title, sheets_values(session, title, gid))

    accounts = rowdicts(tabs['ACCOUNTS'][1])
    products = rowdicts(tabs['PRODUCTS'][1])
    settings = rowdicts(tabs['SETTINGS'][1])

    blocked = {'sản phẩm mẫu', 'san pham mau', 'sample product', 'test product', 'demo product', 'placeholder'}
    valid_products = []
    for p in products:
        name = pick(p, 'Product', 'Product_Name', 'Product Name', 'Tên sản phẩm', 'Name')
        pid = pick(p, 'Product_ID', 'Product ID', 'ProductID')
        link = pick(p, 'Affiliate_Link', 'Affiliate Link', 'Product_URL', 'Product URL', 'Link', 'URL', 'TikTok Shop URL')
        image = pick(p, 'Image_URL', 'Image URL', 'Product_Image', 'Image')
        status = pick(p, 'Status', 'Active', 'Trạng thái').lower()
        if not pid or not name or name.strip().lower() in blocked:
            continue
        if status in {'inactive', 'disabled', 'off', 'false', '0', 'ngừng', 'không'}:
            continue
        if not link:
            continue
        valid_products.append((p, name, pid, link, image))
    if not valid_products:
        raise RuntimeError('NO_VALID_PRODUCT: PRODUCTS không có sản phẩm hợp lệ (đã loại Sản phẩm mẫu/placeholder hoặc thiếu link).')

    active_accounts = []
    for a in accounts:
        aid = pick(a, 'Account_ID', 'Account ID', 'AccountID')
        status = pick(a, 'Status', 'Active', 'Trạng thái').lower()
        if aid and status not in {'inactive', 'disabled', 'off', 'false', '0', 'ngừng', 'không'}:
            active_accounts.append((a, aid))
    if not active_accounts:
        raise RuntimeError('NO_ACTIVE_ACCOUNT: ACCOUNTS không có tài khoản hoạt động.')

    # Deterministic daily rotation, so the same product/account is not always selected.
    day_index = int(datetime.now(timezone.utc).strftime('%Y%m%d'))
    a, account_id = active_accounts[day_index % len(active_accounts)]
    p, product_name, product_id, product_link, image_url = valid_products[day_index % len(valid_products)]

    mode = pick(a, 'Mode', 'TikTok_Mode', 'TikTok Mode') or os.environ.get('TIKTOK_MODE', 'sandbox')
    privacy = pick(a, 'Privacy_Level', 'Privacy Level', 'privacy_level') or os.environ.get('TIKTOK_PRIVACY_LEVEL', 'SELF_ONLY')
    duration = pick(p, 'Duration', 'Video_Duration', 'Video Duration') or '30'
    content_id = f"PFAI-{datetime.now().strftime('%Y%m%d-%H%M%S')}"

    prompt = f'''Bạn là AI vận hành affiliate TikTok hằng ngày. Hôm nay là {datetime.now().strftime('%Y-%m-%d')}.
Sản phẩm: {product_name}
Product_ID: {product_id}
Affiliate link: {product_link}
Tài khoản: {account_id}

Hãy dùng Google Search để tìm thông tin mới, nhu cầu/trend/điểm người mua quan tâm liên quan đến sản phẩm và viết nội dung TikTok ngắn, trung thực, không bịa thông số.
Trả về DUY NHẤT JSON với các khóa: title, hook, body, cta, image_url, duration, privacy_level, mode.
- title <= 120 ký tự.
- hook 1 câu mạnh, không giật tít sai sự thật.
- body 2-4 câu, tập trung lợi ích và điểm cần kiểm tra khi mua.
- cta kêu gọi xem sản phẩm/link.
- image_url giữ nguyên URL ảnh nếu có, nếu không để chuỗi rỗng.
- duration là số nguyên 20-45.
- privacy_level={privacy}; mode={mode}.
- Không được trả WAIT.
'''
    content = gemini(prompt)
    required = ['title', 'hook', 'body', 'cta']
    if any(not str(content.get(k, '')).strip() for k in required):
        raise RuntimeError('AI_EMPTY_CONTENT: Gemini trả về nội dung rỗng.')
    content['image_url'] = content.get('image_url') or image_url
    content['duration'] = max(10, min(60, int(content.get('duration') or duration)))
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
    }
    if headers:
        row = [rowmap.get(next((k for k in rowmap if norm(k) == norm(h)), ''), '') for h in headers]
        append_row(session, content_tab, row)

    with open('/tmp/pfai_content.json', 'w', encoding='utf-8') as f:
        json.dump({'content_id': content_id, 'account_id': account_id, 'product_id': product_id,
                   'product': product_name, 'affiliate_link': product_link, **content}, f, ensure_ascii=False)
    with open(os.environ.get('GITHUB_OUTPUT', '/tmp/pfai_outputs.txt'), 'a', encoding='utf-8') as out:
        for k, v in {'content_id': content_id, 'account_id': account_id, 'product_id': product_id,
                     'product': product_name, 'affiliate_link': product_link, 'title': content['title'],
                     'hook': content['hook'], 'body': content['body'], 'cta': content['cta'],
                     'image_url': content['image_url'], 'duration': content['duration'],
                     'privacy_level': privacy, 'mode': mode}.items():
            out.write(f'{k}={str(v).replace(chr(10), " ")}\n')
    print(json.dumps({'selected_account': account_id, 'selected_product': product_id, 'content_id': content_id,
                      'title': content['title'], 'mode': mode, 'privacy_level': privacy}, ensure_ascii=False))


if __name__ == '__main__':
    main()

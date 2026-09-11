#!/usr/bin/env python3
import json, os, re, urllib.parse
from datetime import datetime, timezone
from google.oauth2 import service_account
from google.auth.transport.requests import AuthorizedSession

SHEET_ID = os.environ.get('GOOGLE_SHEET_ID', '1LUM9KJtQLdfBYWCxKf0Q_VV5TvfnSG2ZtpH-M_3W_20')
CONTENT_GID = '1781613104'

def norm(v):
    return re.sub(r'[^a-z0-9]', '', str(v or '').strip().lower())

def col_letter(n):
    out = ''
    while n:
        n, rem = divmod(n - 1, 26)
        out = chr(65 + rem) + out
    return out

def auth():
    raw = os.environ.get('GOOGLE_SERVICE_ACCOUNT_JSON', '').strip()
    if not raw:
        raise RuntimeError('GOOGLE_SERVICE_ACCOUNT_JSON is not configured in GitHub Secrets.')
    info = json.loads(raw)
    creds = service_account.Credentials.from_service_account_info(info, scopes=['https://www.googleapis.com/auth/spreadsheets'])
    return AuthorizedSession(creds)

def main():
    content = json.load(open('/tmp/pfai_content.json', encoding='utf-8'))
    session = auth()
    meta = session.get(f'https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}?fields=sheets.properties', timeout=30)
    meta.raise_for_status()
    tab = None
    for s in meta.json().get('sheets', []):
        p = s.get('properties', {})
        if str(p.get('sheetId')) == CONTENT_GID:
            tab = p.get('title')
            break
    tab = tab or 'CONTENT'
    rng = urllib.parse.quote(f"'{tab}'!A:ZZ", safe='')
    r = session.get(f'https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{rng}?majorDimension=ROWS', timeout=30)
    r.raise_for_status()
    values = r.json().get('values', [])
    if not values:
        print('SHEET UPDATE: CONTENT is empty; nothing to update.')
        return
    headers = values[0]
    cid = content['content_id']
    row_no = None
    cid_cols = [j for j, h in enumerate(headers) if norm(h) in {'contentid', 'content_id'}]
    for i, row in enumerate(values[1:], start=2):
        if any(j < len(row) and str(row[j]).strip() == cid for j in cid_cols):
            row_no = i
            break
    if not row_no:
        print(f'SHEET UPDATE: CONTENT row not found for {cid}; pipeline result remains valid.')
        return

    old_row = values[row_no - 1]
    row = list(old_row) + [''] * max(0, len(headers) - len(old_row))
    updates = {
        'Video_Status': os.environ.get('VIDEO_STATUS', ''),
        'Publish_Status': os.environ.get('PUBLISH_STATUS', ''),
        'Publish_Date': datetime.now(timezone.utc).isoformat(),
        'Publish_ID': os.environ.get('PUBLISH_ID', ''),
        'Post_ID': os.environ.get('POST_ID', ''),
        'Error': os.environ.get('ERROR_MESSAGE', ''),
    }
    idx = {norm(h): i for i, h in enumerate(headers)}
    for k, v in updates.items():
        if norm(k) in idx:
            row[idx[norm(k)]] = v

    # Update only the actual used columns. Avoid sending A:ZZ, which can cause
    # Google Sheets 400 errors when the sheet's effective column range differs.
    end_col = col_letter(len(headers))
    target = f"{tab}!A{row_no}:{end_col}{row_no}"
    body = {'range': target, 'majorDimension': 'ROWS', 'values': [row[:len(headers)]]}
    put = session.put(
        f'https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{urllib.parse.quote(target, safe="")}?valueInputOption=USER_ENTERED',
        json=body,
        timeout=30,
    )
    if put.status_code >= 400:
        print(f'SHEET UPDATE WARNING: HTTP {put.status_code}: {put.text[:500]}')
        return
    print(f'CONTENT updated: {cid} -> {updates}')

if __name__ == '__main__':
    main()

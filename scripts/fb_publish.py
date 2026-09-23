import os, requests

page_id=os.environ['FACEBOOK_PAGE_ID']
user_or_page_token=os.environ['FACEBOOK_PAGE_ACCESS_TOKEN']
message=os.environ['MESSAGE']
link=os.environ['LINK']

# The stored token may be a user token. Resolve the actual Page access token
# for the configured Page before calling /feed.
r = requests.get(
    'https://graph.facebook.com/v26.0/me/accounts',
    params={
        'fields': 'id,name,access_token,tasks',
        'access_token': user_or_page_token,
    },
    timeout=30,
)
if r.ok:
    accounts = r.json().get('data', [])
    page = next((x for x in accounts if str(x.get('id')) == str(page_id)), None)
    if page and page.get('access_token'):
        token = page['access_token']
    else:
        raise SystemExit(f'Facebook token could not resolve Page access token for page {page_id}. /me/accounts returned {len(accounts)} account(s).')
else:
    # If the stored credential is already a Page token, /me/accounts may fail.
    token = user_or_page_token

url=f'https://graph.facebook.com/v26.0/{page_id}/feed'
r=requests.post(url,data={'message':message,'link':link,'access_token':token},timeout=60)
if not r.ok:
    raise SystemExit(f'Facebook publish failed: HTTP {r.status_code} {r.text}')
print('PASS Facebook post:', r.json())

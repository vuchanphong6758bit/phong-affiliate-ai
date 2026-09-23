import os, requests

page_id=os.environ['FACEBOOK_PAGE_ID']
token=os.environ['FACEBOOK_PAGE_ACCESS_TOKEN']
message=os.environ['MESSAGE']
link=os.environ['LINK']
url=f'https://graph.facebook.com/v23.0/{page_id}/feed'
r=requests.post(url,data={'message':message,'link':link,'access_token':token},timeout=60)
if not r.ok:
    raise SystemExit(f'Facebook publish failed: HTTP {r.status_code} {r.text}')
print('PASS Facebook post:', r.json())

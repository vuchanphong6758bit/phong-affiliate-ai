import os, re, requests

page_id = os.environ['FACEBOOK_PAGE_ID']
user_or_page_token = os.environ['FACEBOOK_PAGE_ACCESS_TOKEN']
message = os.environ['MESSAGE']
link = os.environ['LINK']

# Resolve the configured Page token when the stored credential is a user token.
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
    token = user_or_page_token


def find_og_image(url):
    """Try to extract the product's real preview image from the affiliate URL."""
    try:
        html = requests.get(
            url,
            headers={'User-Agent': 'Mozilla/5.0 (compatible; AffiliateAI/2.0)'},
            timeout=30,
            allow_redirects=True,
        ).text
        patterns = [
            r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)',
            r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
            r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)',
        ]
        for pattern in patterns:
            m = re.search(pattern, html, re.I)
            if m and m.group(1).startswith(('http://', 'https://')):
                return m.group(1).replace('&amp;', '&')
    except Exception as exc:
        print(f'INFO: could not resolve preview image: {exc}')
    return None


# Prefer a visual post. Facebook will show the actual product image instead of a text-only feed card.
image_url = find_og_image(link)
if image_url:
    photo_url = f'https://graph.facebook.com/v26.0/{page_id}/photos'
    r = requests.post(
        photo_url,
        data={'url': image_url, 'caption': message, 'access_token': token},
        timeout=60,
    )
    if r.ok:
        print('PASS Facebook visual post:', r.json())
    else:
        print(f'INFO: photo publish failed, falling back to link post: HTTP {r.status_code} {r.text}')
        r = None
else:
    r = None

# Fallback keeps the workflow reliable when Shopee blocks image scraping.
if r is None or not r.ok:
    url = f'https://graph.facebook.com/v26.0/{page_id}/feed'
    r = requests.post(url, data={'message': message, 'link': link, 'access_token': token}, timeout=60)
    if not r.ok:
        raise SystemExit(f'Facebook publish failed: HTTP {r.status_code} {r.text}')
    print('PASS Facebook link post:', r.json())

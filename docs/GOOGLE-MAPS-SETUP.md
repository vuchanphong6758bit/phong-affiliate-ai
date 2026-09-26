# Nhoy Tea Google Maps API-only workflow

Remote Mac is not part of this workflow.

## What is already implemented

- Hourly scheduler during Nhoy Tea business window: 13:00–03:00 Asia/Ho_Chi_Minh.
- One post per local calendar day.
- Controlled posting-hour rotation, defaulting to 18:00, 19:00, 20:00, 21:00 in sequence. This is an A/B/C/D experiment because official daily GBP metrics are not available at per-post/per-hour granularity.
- AI-generated image on every post.
- Optional reference-image editing via `NHOYTEA_REFERENCE_IMAGE_URL` so the storefront identity stays consistent.
- Cloudinary unsigned upload to produce a real HTTPS image URL.
- Google Business Profile Local Post creation through API with an ORDER CTA.
- Daily KPI collection at 06:00 Vietnam time.
- State/history committed to the repository.

## One-time credentials that cannot be fabricated by the workflow

These are account authorization values and must be supplied by the account owner:

### Google Business Profile

Create/enable the required Google Business Profile APIs in Google Cloud, create an OAuth 2.0 client, and authorize the Google account that owns/manages Nhoy Tea with scope:

`https://www.googleapis.com/auth/business.manage`

Store:

- `GBP_CLIENT_ID`
- `GBP_CLIENT_SECRET`
- `GBP_REFRESH_TOKEN`
- `GBP_LOCATION_NAME` = `accounts/ACCOUNT_ID/locations/LOCATION_ID`

Optional: `GBP_ACCOUNT_NAME` = `accounts/ACCOUNT_ID`.

The workflow can discover the location by name/address when `GBP_LOCATION_NAME` is omitted, but storing the explicit location name is safer.

### Cloudinary

Use the Cloudinary account already created for this project.

Store:

- `CLOUDINARY_CLOUD_NAME` = the cloud name shown in Cloudinary.
- `CLOUDINARY_UPLOAD_PRESET` = the unsigned preset created for Nhoy Tea (currently named `nhoytea_googlemaps` in the setup shown in the conversation).
- `NHOYTEA_REFERENCE_IMAGE_URL` = a public HTTPS Cloudinary URL of the real storefront photo. This is used as the visual reference for AI image editing.

### OpenAI

Store:

- `OPENAI_API_KEY`

Variables (optional):

- `OPENAI_IMAGE_MODEL` = `gpt-image-2`
- `OPENAI_IMAGE_SIZE` = `1024x1024`
- `OPENAI_IMAGE_QUALITY` = `medium`

### Ordering CTA

Store:

- `GBP_ORDER_URL` = the real order/landing URL used by Nhoy Tea.

Do not invent merchant deep links. If a single landing page for Grab/Be/ShopeeFood/Xanh SM is not available yet, use the Google Maps URL temporarily; the workflow remains functional and the CTA can be changed later without changing the publishing code.

## GitHub Actions settings

In the repository, open **Settings → Secrets and variables → Actions** and add the secrets above.

The workflow files are:

- `.github/workflows/googlemaps-daily.yml`
- `.github/workflows/googlemaps-report.yml`

## Important API limitation

The current Google Business Profile Performance API provides profile-level impressions and actions such as Maps/Search impressions, direction requests, calls, website clicks, conversations, bookings and menu clicks. The old per-Local-Post insights endpoint was removed. Therefore the report must not invent per-post views, comments or shares. The workflow records the post ID and image URL, while KPI reporting uses official profile-level metrics.

## Image policy implemented

The prompt explicitly keeps the shop takeaway-only: no tables and no chairs. It requests realistic customers/riders and a clean, premium-but-authentic Vietnamese street-photo look. When the reference URL is configured, the image is edited from the real storefront photo rather than inventing a different storefront.

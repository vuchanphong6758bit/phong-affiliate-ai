import os

REQUIRED = ["OPENAI_API_KEY", "LAZADA_AFFILIATE_FEED_URL"]
OPTIONAL_FOR_PUBLISH = ["PUBLISH_WEBHOOK_URL"]
OPTIONAL_FOR_METRICS = ["LAZADA_AFFILIATE_METRICS_URL", "META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"]

missing = [name for name in REQUIRED if not os.getenv(name)]
if missing:
    print("MISSING_REQUIRED=" + ",".join(missing))
    raise SystemExit(2)

print("REQUIRED_CONFIGURATION=OK")
print("PUBLISH_CONFIGURATION=" + ("OK" if os.getenv("PUBLISH_WEBHOOK_URL") else "MISSING"))
meta_ok = bool(os.getenv("META_ACCESS_TOKEN") and os.getenv("META_AD_ACCOUNT_ID"))
print("METRICS_CONFIGURATION=" + ("OK" if os.getenv("LAZADA_AFFILIATE_METRICS_URL") or meta_ok else "MISSING"))

import requests


def fetch_products(feed_url: str) -> list[dict]:
    if not feed_url:
        raise RuntimeError("LAZADA_AFFILIATE_FEED_URL is not configured")
    response = requests.get(feed_url, timeout=30)
    response.raise_for_status()
    payload = response.json()
    items = payload.get("products", payload) if isinstance(payload, dict) else payload
    if not isinstance(items, list):
        raise RuntimeError("Lazada affiliate feed returned an unsupported format")
    normalized = []
    for item in items:
        price = float(item.get("price", 0) or 0)
        rate = float(item.get("commission_rate", item.get("commissionRate", 0)) or 0)
        commission = float(item.get("commission", price * rate / 100) or 0)
        if price > 0 and commission > 0:
            normalized.append({
                "id": str(item.get("id") or item.get("sku") or item.get("product_id")),
                "name": item.get("name", ""),
                "url": item.get("url", ""),
                "price": price,
                "commission_rate": rate,
                "commission": commission,
                "metadata": item,
            })
    return normalized


def fetch_metrics(metrics_url: str) -> dict:
    if not metrics_url:
        return {}
    response = requests.get(metrics_url, timeout=30)
    response.raise_for_status()
    return response.json()

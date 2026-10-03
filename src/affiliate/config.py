import os


def env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def require(name: str) -> str:
    value = env(name)
    if not value:
        raise RuntimeError(f"Missing required configuration: {name}")
    return value


def settings() -> dict:
    return {
        "lazada_feed_url": env("LAZADA_AFFILIATE_FEED_URL"),
        "lazada_metrics_url": env("LAZADA_AFFILIATE_METRICS_URL"),
        "publish_webhook_url": env("PUBLISH_WEBHOOK_URL"),
        "openai_model": env("OPENAI_MODEL", "gpt-5.6"),
        "min_profit_vnd": float(env("MIN_EXPECTED_PROFIT_VND", "10000")),
        "expected_ad_cost_vnd": float(env("MIN_EXPECTED_AD_COST_PER_ORDER", "25000")),
        "max_products_per_run": int(env("MAX_PRODUCTS_PER_RUN", "5")),
    }

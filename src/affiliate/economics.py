def rank_products(products: list[dict], expected_ad_cost_vnd: float, min_profit_vnd: float, limit: int = 5) -> list[dict]:
    ranked = []
    for product in products:
        commission = float(product.get("commission", 0) or 0)
        score = commission - expected_ad_cost_vnd
        if commission > 0 and score >= min_profit_vnd:
            ranked.append({**product, "expected_profit": score})
    ranked.sort(key=lambda item: item["expected_profit"], reverse=True)
    return ranked[:limit]

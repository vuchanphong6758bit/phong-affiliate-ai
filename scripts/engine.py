import json, os, sqlite3, time
from datetime import datetime, timezone, timedelta
from pathlib import Path
import requests
from openai import OpenAI

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)
DB = DATA / "affiliate_ai.sqlite3"
VN = timezone(timedelta(hours=7))


def db():
    c = sqlite3.connect(DB)
    c.execute("""CREATE TABLE IF NOT EXISTS products(
      id TEXT PRIMARY KEY, name TEXT, url TEXT, price REAL, commission_rate REAL,
      commission REAL, score REAL, metadata TEXT, updated_at TEXT)""")
    c.execute("""CREATE TABLE IF NOT EXISTS posts(
      id INTEGER PRIMARY KEY AUTOINCREMENT, product_id TEXT, title TEXT, body TEXT,
      published_url TEXT, created_at TEXT, views INTEGER DEFAULT 0, orders INTEGER DEFAULT 0,
      commission REAL DEFAULT 0, ad_spend REAL DEFAULT 0, profit REAL DEFAULT 0,
      ctr REAL DEFAULT 0, conversion_rate REAL DEFAULT 0)""")
    c.execute("""CREATE TABLE IF NOT EXISTS experiments(
      id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER, hypothesis TEXT,
      result TEXT, created_at TEXT)""")
    return c


def get_products():
    # Preferred: a user-provided affiliate feed/API adapter.
    url = os.getenv("LAZADA_AFFILIATE_FEED_URL")
    if not url:
        return []
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    payload = r.json()
    return payload.get("products", payload if isinstance(payload, list) else [])


def normalize_products(items):
    out=[]
    for x in items:
        price=float(x.get("price",0) or 0)
        rate=float(x.get("commission_rate", x.get("commissionRate",0)) or 0)
        commission=float(x.get("commission", price*rate/100))
        if price <= 0 or commission <= 0: continue
        out.append({"id":str(x.get("id") or x.get("sku") or x.get("product_id")),
                    "name":x.get("name",""),"url":x.get("url",""),"price":price,
                    "commission_rate":rate,"commission":commission,"metadata":x})
    return out


def estimate_ad_cost():
    # Use the last 7 days' Meta spend per landing-page view as a conservative CPA proxy.
    # If no Meta data is configured, use the explicit planning floor.
    return float(os.getenv("MIN_EXPECTED_AD_COST_PER_ORDER", "25000"))


def rank(products):
    min_margin = float(os.getenv("MIN_EXPECTED_PROFIT_VND", "10000"))
    ad_cost = estimate_ad_cost()
    for p in products:
        p["score"] = p["commission"] - ad_cost
    return [p for p in sorted(products, key=lambda z:z["score"], reverse=True) if p["score"] >= min_margin]


def learning_context(c):
    rows=c.execute("SELECT title, body, views, orders, commission, ad_spend, profit, conversion_rate FROM posts ORDER BY id DESC LIMIT 10").fetchall()
    return [{"title":r[0],"views":r[2],"orders":r[3],"commission":r[4],"ad_spend":r[5],"profit":r[6],"conversion_rate":r[7]} for r in rows]


def generate_post(product, context):
    client=OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    prompt=f"""Bạn là AI tối ưu affiliate marketing tại Việt Nam. Viết 1 bài bán hàng trung thực cho sản phẩm sau.
Sản phẩm: {product['name']}
Giá: {product['price']:,.0f} VND
Hoa hồng dự kiến: {product['commission']:,.0f} VND
URL affiliate: {product['url']}
Dữ liệu các bài trước: {json.dumps(context, ensure_ascii=False)}
Mục tiêu: tăng xác suất mua so với bài trước, không bịa tính năng/giá/khuyến mãi, không tạo tuyên bố y tế hay đảm bảo kết quả.
Trả JSON gồm title, body, hypothesis, cta. Body 500-900 từ tiếng Việt, có CTA rõ ràng và chèn URL đúng 1 lần."""
    r=client.responses.create(model=os.getenv("OPENAI_MODEL","gpt-5.6"), input=prompt)
    text=r.output_text
    try: return json.loads(text)
    except Exception:
        return {"title":product["name"],"body":text,"hypothesis":"Test góc lợi ích + bằng chứng sản phẩm","cta":"Xem sản phẩm"}


def publish(post):
    webhook=os.getenv("PUBLISH_WEBHOOK_URL")
    if not webhook: return ""
    r=requests.post(webhook,json=post,timeout=30)
    r.raise_for_status()
    data=r.json() if r.content else {}
    return data.get("url", "")


def main():
    c=db()
    products=normalize_products(get_products())
    candidates=rank(products)
    if not candidates:
        print("No profitable products found; skipping publication.")
        return
    chosen=candidates[0]
    now=datetime.now(VN).isoformat()
    c.execute("INSERT OR REPLACE INTO products VALUES(?,?,?,?,?,?,?,?,?)",
      (chosen["id"],chosen["name"],chosen["url"],chosen["price"],chosen["commission_rate"],chosen["commission"],chosen["score"],json.dumps(chosen["metadata"],ensure_ascii=False),now))
    post=generate_post(chosen,learning_context(c))
    published_url=publish({**post,"product":chosen})
    c.execute("INSERT INTO posts(product_id,title,body,published_url,created_at) VALUES(?,?,?,?,?)",
      (chosen["id"],post.get("title",""),post.get("body",""),published_url,now))
    c.commit(); c.close()
    print(json.dumps({"product":chosen,"post":post,"published_url":published_url},ensure_ascii=False))

if __name__ == "__main__": main()

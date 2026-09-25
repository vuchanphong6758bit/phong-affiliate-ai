import json, os, sqlite3
from datetime import datetime, timezone, timedelta
from pathlib import Path
import requests
from openai import OpenAI
ROOT=Path(__file__).resolve().parents[1]; DATA=ROOT/"data"; DATA.mkdir(exist_ok=True); DB=DATA/"affiliate_ai.sqlite3"; STATE=DATA/"state.json"; VN=timezone(timedelta(hours=7))
def db():
    c=sqlite3.connect(DB); c.execute("CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,name TEXT,url TEXT,price REAL,commission_rate REAL,commission REAL,score REAL,metadata TEXT,updated_at TEXT)"); c.execute("CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY AUTOINCREMENT,product_id TEXT,title TEXT,body TEXT,published_url TEXT,created_at TEXT,views INTEGER DEFAULT 0,orders INTEGER DEFAULT 0,commission REAL DEFAULT 0,ad_spend REAL DEFAULT 0,profit REAL DEFAULT 0,ctr REAL DEFAULT 0,conversion_rate REAL DEFAULT 0)"); return c
def get_products():
    u=os.getenv("LAZADA_AFFILIATE_FEED_URL")
    if not u:return []
    r=requests.get(u,timeout=30); r.raise_for_status(); p=r.json(); return p.get("products",p if isinstance(p,list) else [])
def normalize(items):
    out=[]
    for x in items:
        price=float(x.get("price",0) or 0); rate=float(x.get("commission_rate",x.get("commissionRate",0)) or 0); commission=float(x.get("commission",price*rate/100))
        if price>0 and commission>0: out.append({"id":str(x.get("id") or x.get("sku") or x.get("product_id")),"name":x.get("name",""),"url":x.get("url",""),"price":price,"commission_rate":rate,"commission":commission,"metadata":x})
    return out
def rank(products):
    floor=float(os.getenv("MIN_EXPECTED_AD_COST_PER_ORDER","25000")); min_profit=float(os.getenv("MIN_EXPECTED_PROFIT_VND","10000"))
    for p in products:p["score"]=p["commission"]-floor
    return [p for p in sorted(products,key=lambda x:x["score"],reverse=True) if p["score"]>=min_profit]
def context(c):
    rows=c.execute("SELECT title,views,orders,commission,ad_spend,profit,conversion_rate FROM posts ORDER BY id DESC LIMIT 10").fetchall(); out=[dict(zip(["title","views","orders","commission","ad_spend","profit","conversion_rate"],r)) for r in rows]
    if STATE.exists(): out += json.loads(STATE.read_text(encoding="utf-8")).get("metrics",[])[-10:]
    return out[-20:]
def generate(product,ctx):
    client=OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    prompt=f'''Bạn là AI tối ưu affiliate marketing tại Việt Nam. Viết một bài bán hàng trung thực cho sản phẩm.
Sản phẩm: {product['name']} | Giá: {product['price']:,.0f} VND | Hoa hồng dự kiến: {product['commission']:,.0f} VND | URL: {product['url']}
Dữ liệu bài trước: {json.dumps(ctx,ensure_ascii=False)}
Mục tiêu: tăng conversion so với dữ liệu lịch sử. Không bịa giá, tính năng, khuyến mãi; không tuyên bố y tế/đảm bảo kết quả.
Trả JSON: title, body, hypothesis, cta. Body 500-900 từ tiếng Việt, CTA rõ, URL đúng 1 lần.'''
    r=client.responses.create(model=os.getenv("OPENAI_MODEL","gpt-5.6"),input=prompt)
    try:
        return json.loads(r.output_text)
    except Exception:
        return {"title":product["name"],"body":r.output_text,"hypothesis":"Tối ưu góc lợi ích và CTA","cta":"Xem sản phẩm"}
def publish(payload):
    u=os.getenv("PUBLISH_WEBHOOK_URL")
    if not u:return ""
    r=requests.post(u,json=payload,timeout=30); r.raise_for_status(); return (r.json() if r.content else {}).get("url","")
def main():
    c=db(); products=rank(normalize(get_products()))
    if not products: print("No profitable products found."); return
    p=products[0]; now=datetime.now(VN).isoformat(); post=generate(p,context(c)); published=publish({**post,"product":p})
    c.execute("INSERT OR REPLACE INTO products VALUES(?,?,?,?,?,?,?,?,?)",(p["id"],p["name"],p["url"],p["price"],p["commission_rate"],p["commission"],p["score"],json.dumps(p["metadata"],ensure_ascii=False),now)); c.execute("INSERT INTO posts(product_id,title,body,published_url,created_at) VALUES(?,?,?,?,?)",(p["id"],post.get("title",""),post.get("body",""),published,now)); c.commit()
    state=json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {"posts":[],"metrics":[]}; state["posts"].append({"product_id":p["id"],"title":post.get("title",""),"published_url":published,"created_at":now}); state["posts"]=state["posts"][-90:]; STATE.write_text(json.dumps(state,ensure_ascii=False,indent=2),encoding="utf-8"); c.close()
    print(json.dumps({"product":p,"post":post,"published_url":published},ensure_ascii=False))
if __name__=="__main__":main()

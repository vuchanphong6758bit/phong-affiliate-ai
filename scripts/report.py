import json, os, smtplib
from datetime import datetime, timezone, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
import requests

ROOT=Path(__file__).resolve().parents[1]
STATE=ROOT/"data"/"state.json"
VN=timezone(timedelta(hours=7))

def load():
    if not STATE.exists(): return {"posts":[]}
    return json.loads(STATE.read_text(encoding="utf-8"))

def meta_metrics():
    token=os.getenv("META_ACCESS_TOKEN"); account=os.getenv("META_AD_ACCOUNT_ID")
    if not token or not account: return {"views":0,"spend":0.0,"orders":0}
    fields="impressions,spend,actions"
    params={"access_token":token,"fields":fields,"date_preset":"yesterday"}
    r=requests.get(f"https://graph.facebook.com/v23.0/act_{account}/insights",params=params,timeout=30)
    r.raise_for_status(); data=r.json().get("data",[])
    impressions=sum(int(float(x.get("impressions",0))) for x in data)
    spend=sum(float(x.get("spend",0)) for x in data)
    return {"views":impressions,"spend":spend,"orders":0}

def affiliate_metrics():
    url=os.getenv("LAZADA_AFFILIATE_METRICS_URL")
    if not url: return {"orders":0,"commission":0.0,"views":0}
    r=requests.get(url,timeout=30); r.raise_for_status(); d=r.json()
    return {"orders":int(d.get("orders",0)),"commission":float(d.get("commission",0)),"views":int(d.get("views",0))}

def send(subject, html):
    host=os.environ["SMTP_HOST"]; port=int(os.getenv("SMTP_PORT","587")); user=os.environ["SMTP_USER"]; pw=os.environ["SMTP_PASSWORD"]; to=os.getenv("REPORT_TO","vuchanphong6758@gmail.com")
    m=MIMEMultipart("alternative"); m["Subject"]=subject; m["From"]=user; m["To"]=to; m.attach(MIMEText(html,"html","utf-8"))
    with smtplib.SMTP(host,port) as s:
        s.starttls(); s.login(user,pw); s.sendmail(user,[to],m.as_string())

def main():
    st=load(); meta=meta_metrics(); aff=affiliate_metrics();
    posts=st.get("posts",[]); latest=posts[-1] if posts else {}
    views=aff["views"] or meta["views"]; orders=aff["orders"]
    commission=aff["commission"]
    spend=meta["spend"]*float(os.getenv("USD_TO_VND","25000"))
    conversion=(orders/views*100) if views else 0
    profit=commission-spend
    html=f"""<h2>Phong Affiliate AI — báo cáo {datetime.now(VN).strftime('%d/%m/%Y')}</h2>
<table border='1' cellpadding='8' cellspacing='0'><tr><th>Chỉ số</th><th>Giá trị</th></tr>
<tr><td>Lượt view</td><td>{views:,}</td></tr><tr><td>Lượt mua hàng</td><td>{orders:,}</td></tr>
<tr><td>Tỷ lệ mua sau view</td><td>{conversion:.2f}%</td></tr><tr><td>Chi phí Facebook Ads</td><td>{spend:,.0f} VND</td></tr>
<tr><td>Tổng hoa hồng</td><td>{commission:,.0f} VND</td></tr><tr><td><b>Lợi nhuận cuối cùng</b></td><td><b>{profit:,.0f} VND</b></td></tr></table>
<p>Bài gần nhất: {latest.get('title','Chưa có')}<br>URL: {latest.get('published_url','Chưa cấu hình')}</p>"""
    send(f"Affiliate AI Report — {datetime.now(VN).strftime('%Y-%m-%d')}",html)

if __name__ == "__main__": main()

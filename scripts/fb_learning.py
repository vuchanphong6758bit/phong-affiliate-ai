#!/usr/bin/env python3
import glob, json, os, statistics, time
from datetime import datetime, timezone
import requests

PAGE_ID = os.environ.get('FACEBOOK_PAGE_ID','').strip()
TOKEN = os.environ.get('FACEBOOK_PAGE_ACCESS_TOKEN','').strip()
OUT = 'data/learning/facebook-learning.json'


def resolve_token():
    if not TOKEN:
        return ''
    r = requests.get('https://graph.facebook.com/v26.0/me/accounts', params={'fields':'id,access_token','access_token':TOKEN}, timeout=30)
    if r.ok:
        for p in r.json().get('data',[]):
            if str(p.get('id')) == str(PAGE_ID) and p.get('access_token'):
                return p['access_token']
    return TOKEN


def metric_value(data, names):
    for item in data.get('data',[]) if isinstance(data,dict) else []:
        if item.get('name') in names:
            vals = item.get('values') or []
            if vals:
                v = vals[-1].get('value')
                if isinstance(v,(int,float)):
                    return float(v)
                if isinstance(v,dict):
                    return float(sum(v.values()))
    return 0.0


def fetch_insights(post_id, token):
    metrics = 'post_impressions,post_reactions_by_type_total,post_clicks,post_engaged_users'
    r = requests.get(f'https://graph.facebook.com/v26.0/{post_id}/insights', params={'metric':metrics,'access_token':token}, timeout=30)
    if not r.ok:
        return {'available':False,'error':f'HTTP {r.status_code}'}
    data = r.json()
    return {
        'available': True,
        'impressions': metric_value(data, {'post_impressions','post_impressions_unique'}),
        'clicks': metric_value(data, {'post_clicks','post_link_clicks'}),
        'engaged_users': metric_value(data, {'post_engaged_users'}),
        'reactions': metric_value(data, {'post_reactions_by_type_total'}),
    }


def main():
    os.makedirs('data/learning', exist_ok=True)
    files = sorted(glob.glob('data/runs/*.json'))
    records=[]
    token=resolve_token() if PAGE_ID else TOKEN
    for path in files[-30:]:
        try:
            r=json.load(open(path,encoding='utf-8'))
        except Exception:
            continue
        if not r.get('post_id'):
            continue
        insight=fetch_insights(str(r['post_id']),token) if token else {'available':False,'error':'missing token'}
        r['insights']=insight
        r['measured_at']=datetime.now(timezone.utc).isoformat()
        records.append(r)
        time.sleep(0.2)

    by_product={}
    by_type={}
    for r in records:
        i=r.get('insights') or {}
        if not i.get('available'): continue
        key=str(r.get('product_id') or '')
        bucket=by_product.setdefault(key, {'posts':0,'impressions':0,'clicks':0,'engaged':0,'reactions':0})
        bucket['posts']+=1
        for k in ('impressions','clicks','engaged','reactions'): bucket[k]+=float(i.get(k) or 0)
        typ=r.get('post_type') or 'unknown'
        t=by_type.setdefault(typ, {'posts':0,'impressions':0,'clicks':0,'engaged':0})
        t['posts']+=1
        t['impressions']+=float(i.get('impressions') or 0)
        t['clicks']+=float(i.get('clicks') or 0)
        t['engaged']+=float(i.get('engaged_users') or 0)

    def rate(a,b): return round(a/b,4) if b else 0
    for b in by_product.values():
        b['ctr']=rate(b['clicks'],b['impressions'])
        b['engagement_rate']=rate(b['engaged'],b['impressions'])
    for b in by_type.values():
        b['ctr']=rate(b['clicks'],b['impressions'])
        b['engagement_rate']=rate(b['engaged'],b['impressions'])

    top_products=sorted(by_product.items(), key=lambda kv:(kv[1]['clicks'],kv[1]['engagement_rate'],kv[1]['impressions']), reverse=True)
    strategy={
        'generated_at':datetime.now(timezone.utc).isoformat(),
        'measurement_available': bool(records),
        'observations': len(records),
        'top_products':[{'product_id':k,**v} for k,v in top_products[:5]],
        'post_types':by_type,
        'rules':[
            'Ưu tiên sản phẩm có click và engagement thực tế tốt hơn trung vị.',
            'Giảm tần suất sản phẩm có impressions nhưng CTR thấp sau đủ mẫu.',
            'Không kết luận từ một bài duy nhất; cần tối thiểu 3 quan sát khi có thể.',
            'Không dùng bot, click ảo, tài khoản ảo hoặc hành vi thao túng tương tác.',
        ]
    }
    json.dump(strategy,open(OUT,'w',encoding='utf-8'),ensure_ascii=False,indent=2)
    print(json.dumps(strategy,ensure_ascii=False))

if __name__=='__main__': main()

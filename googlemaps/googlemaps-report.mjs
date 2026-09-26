import fs from 'node:fs/promises';
const TZ='Asia/Ho_Chi_Minh';
const HISTORY_FILE=process.env.NHOYTEA_HISTORY_FILE||'data/googlemaps-history.json';
const required=k=>{const v=process.env[k];if(!v)throw new Error(`Missing required env: ${k}`);return v};
async function json(url,options={}){const r=await fetch(url,options);const t=await r.text();let b;try{b=JSON.parse(t)}catch{b=t}if(!r.ok)throw new Error(`${r.status} ${url}: ${typeof b==='string'?b.slice(0,800):JSON.stringify(b).slice(0,1200)}`);return b}
async function token(){return (await json('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:required('GBP_CLIENT_ID'),client_secret:required('GBP_CLIENT_SECRET'),refresh_token:required('GBP_REFRESH_TOKEN'),grant_type:'refresh_token'})})).access_token}
function parts(d=new Date()){const p=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);const o=Object.fromEntries(p.map(x=>[x.type,x.value]));return{date:`${o.year}-${o.month}-${o.day}`}}
function addDays(iso,n){const d=new Date(`${iso}T12:00:00+07:00`);d.setDate(d.getDate()+n);return d.toISOString().slice(0,10)}
async function read(){try{return JSON.parse(await fs.readFile(HISTORY_FILE,'utf8'))}catch{return{posts:[],metrics:[],lastPostDate:null}}}
async function write(h){await fs.writeFile(HISTORY_FILE,JSON.stringify(h,null,2)+'\n')}
async function main(){
 const now=parts(); const h=await read(); const t=await token();
 const loc=required('GBP_LOCATION_NAME');
 const start=addDays(now.date,-1), end=now.date;
 const metrics=['BUSINESS_IMPRESSIONS_DESKTOP_MAPS','BUSINESS_IMPRESSIONS_MOBILE_MAPS','BUSINESS_IMPRESSIONS_DESKTOP_SEARCH','BUSINESS_IMPRESSIONS_MOBILE_SEARCH','BUSINESS_DIRECTION_REQUESTS','CALL_CLICKS','WEBSITE_CLICKS','BUSINESS_CONVERSATIONS','BUSINESS_BOOKINGS','BUSINESS_FOOD_MENU_CLICKS'];
 const q=metrics.map(m=>`dailyMetrics=${encodeURIComponent(m)}`).join('&');
 const url=`https://businessprofileperformance.googleapis.com/v1/${loc}:fetchMultiDailyMetricsTimeSeries?${q}&dailyRange.startDate.year=${start.slice(0,4)}&dailyRange.startDate.month=${Number(start.slice(5,7))}&dailyRange.startDate.day=${Number(start.slice(8,10))}&dailyRange.endDate.year=${end.slice(0,4)}&dailyRange.endDate.month=${Number(end.slice(5,7))}&dailyRange.endDate.day=${Number(end.slice(8,10))}`;
 const data=await json(url,{headers:{authorization:`Bearer ${t}`}});
 const totals={date:start,maps:0,search:0,direction:0,calls:0,website:0,conversations:0,bookings:0,menu:0};
 for(const s of data.multiDailyMetricTimeSeries||[]){const name=s.dailyMetric;const value=(s.timeSeries?.datedValues||[]).find(x=>x.date?.year===Number(start.slice(0,4))&&x.date?.month===Number(start.slice(5,7))&&x.date?.day===Number(start.slice(8,10)))?.value?.value||0; if(name.includes('MAPS'))totals.maps+=Number(value);else if(name.includes('SEARCH'))totals.search+=Number(value);else if(name==='BUSINESS_DIRECTION_REQUESTS')totals.direction+=Number(value);else if(name==='CALL_CLICKS')totals.calls+=Number(value);else if(name==='WEBSITE_CLICKS')totals.website+=Number(value);else if(name==='BUSINESS_CONVERSATIONS')totals.conversations+=Number(value);else if(name==='BUSINESS_BOOKINGS')totals.bookings+=Number(value);else if(name==='BUSINESS_FOOD_MENU_CLICKS')totals.menu+=Number(value)}
 h.metrics.push({...totals,hour:new Date().getHours()});h.metrics=h.metrics.slice(-60);await write(h);
 const last=h.posts.at(-1);
 const report={date:start,profile:{mapsImpressions:totals.maps,searchImpressions:totals.search,directionRequests:totals.direction,callClicks:totals.calls,websiteClicks:totals.website,conversations:totals.conversations,bookings:totals.bookings,menuClicks:totals.menu},lastPost:last?{createdAt:last.createdAt,postName:last.postName,imageUrl:last.imageUrl,hook:last.hook}:null,limitations:'Official GBP APIs expose profile impressions/actions and reviews, but not a reliable per-post comments/shares counter. Do not invent those values.'};
 console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(e.stack||e);process.exit(1)})

import fs from 'node:fs/promises';

const env = (k, fallback = '') => process.env[k] || fallback;
const required = (k) => { const v = env(k); if (!v) throw new Error(`Missing required env: ${k}`); return v; };
const TZ = 'Asia/Ho_Chi_Minh';
const ADDRESS = env('NHOYTEA_ADDRESS', '572/28/2 Âu Cơ, phường Bảy Hiền, TP. HCM');
const HISTORY_FILE = env('NHOYTEA_HISTORY_FILE', 'data/googlemaps-history.json');

function localParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }).formatToParts(date);
  const o = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return { date: `${o.year}-${o.month}-${o.day}`, hour: Number(o.hour), minute: Number(o.minute) };
}
async function readHistory() { try { return JSON.parse(await fs.readFile(HISTORY_FILE, 'utf8')); } catch { return { posts: [], metrics: [], lastPostDate: null }; } }
async function writeHistory(h) { await fs.mkdir(HISTORY_FILE.split('/').slice(0,-1).join('/') || '.', { recursive:true }); await fs.writeFile(HISTORY_FILE, JSON.stringify(h, null, 2) + '\n'); }
async function json(url, options = {}) { const r = await fetch(url, options); const text = await r.text(); let body; try { body = JSON.parse(text); } catch { body = text; } if (!r.ok) throw new Error(`${r.status} ${r.statusText} ${url}: ${typeof body === 'string' ? body.slice(0,600) : JSON.stringify(body).slice(0,1200)}`); return body; }
async function googleAccessToken() { return (await json('https://oauth2.googleapis.com/token', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({ client_id:required('GBP_CLIENT_ID'), client_secret:required('GBP_CLIENT_SECRET'), refresh_token:required('GBP_REFRESH_TOKEN'), grant_type:'refresh_token' }) })).access_token; }
async function googleAccounts(token) { return json('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', { headers:{authorization:`Bearer ${token}`} }); }
async function discoverLocation(token) { const accountName = env('GBP_ACCOUNT_NAME'); const accounts = accountName ? { accounts:[{name:accountName}] } : await googleAccounts(token); for (const a of accounts.accounts || []) { const u = `https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?readMask=name,title,storeCode,metadata&pageSize=100`; const r = await json(u, {headers:{authorization:`Bearer ${token}`}}); const hit = (r.locations || []).find(x => /nhoy\s*tea/i.test(x.title || '') || /572\/28\/2.*âu cơ/i.test(x.address?.addressLines?.join(' ') || '')); if (hit) return hit.name; } throw new Error('Could not discover Nhoy Tea location. Set GBP_LOCATION_NAME=accounts/.../locations/...'); }
async function getLocation(token) { return env('GBP_LOCATION_NAME') || await discoverLocation(token); }

function pickHook(history) {
  const hooks = [
    'Tối nay uống gì? Nhoy Tea pha ly mới, ghé lấy mang về là có ngay.',
    '19h rồi: trà ngon, đơn đang chạy. Ghé Nhoy Tea lấy ly yêu thích hoặc đặt giao tận nơi.',
    'Một ly trà mát cho buổi tối? Nhoy Tea mở đến 03:00, ghé mua mang về hoặc đặt app.',
    'Đang thèm trà sữa? Nhoy Tea hôm nay lên ly mới, tiện đường thì ghé lấy nhé.',
    'Tối nay không cần ngồi quán — Nhoy Tea làm ly thật ngon để bạn mang đi hoặc đặt giao.'
  ];
  const used = new Set((history.posts || []).slice(-10).map(p => p.hook));
  return hooks.find(x => !used.has(x)) || hooks[Math.floor(Math.random()*hooks.length)];
}
function orderUrl() { return env('GBP_ORDER_URL') || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`Nhoy Tea, ${ADDRESS}`)}`; }
function promptForImage(history) { const angle = ['mãng cầu trà sữa','trà sữa thơm béo','trà trái cây mát lạnh','một ly signature của quán'][history.posts.length % 4]; return `Create a realistic Vietnamese street-food beverage photo for Nhoy Tea in Ho Chi Minh City. The business is takeaway-only: NO tables, NO chairs, NO dine-in seating. Keep the exact identity and proportions of the storefront if a reference image is supplied. Show a clean, believable takeaway counter and ${angle} as the visual hero. Add a natural amount of real-looking customers and delivery riders waiting for orders, but do not fabricate logos or unreadable text. Night/evening atmosphere, documentary smartphone photography, realistic lighting, crisp details, appetizing drink condensation, premium but authentic, not glossy advertising, no text overlays, no collage, no poster layout, no fake storefront redesign.`; }

async function generateImage(history) {
  const apiKey = required('OPENAI_API_KEY'); const model = env('OPENAI_IMAGE_MODEL', 'gpt-image-2'); const reference = env('NHOYTEA_REFERENCE_IMAGE_URL'); let imageResponse;
  if (reference) {
    const src = await fetch(reference); if (!src.ok) throw new Error(`Reference image fetch failed: ${src.status}`); const buf = Buffer.from(await src.arrayBuffer());
    const form = new FormData(); form.append('model', model); form.append('prompt', promptForImage(history)); form.append('image', new Blob([buf], {type: src.headers.get('content-type') || 'image/jpeg'}), 'reference.jpg'); form.append('size', env('OPENAI_IMAGE_SIZE', '1024x1024')); form.append('quality', env('OPENAI_IMAGE_QUALITY', 'medium'));
    imageResponse = await fetch('https://api.openai.com/v1/images/edits', { method:'POST', headers:{authorization:`Bearer ${apiKey}`}, body:form });
  } else {
    imageResponse = await fetch('https://api.openai.com/v1/images/generations', { method:'POST', headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'}, body:JSON.stringify({model,prompt:promptForImage(history),size:env('OPENAI_IMAGE_SIZE','1024x1024'),quality:env('OPENAI_IMAGE_QUALITY','medium')}) });
  }
  const text = await imageResponse.text(); if (!imageResponse.ok) throw new Error(`OpenAI image error ${imageResponse.status}: ${text.slice(0,1200)}`); const out = JSON.parse(text); const b64 = out.data?.[0]?.b64_json; if (!b64) throw new Error('OpenAI image response did not contain b64_json'); return Buffer.from(b64, 'base64');
}
async function uploadCloudinary(bytes) { const cloud = required('CLOUDINARY_CLOUD_NAME'); const preset = required('CLOUDINARY_UPLOAD_PRESET'); const form = new FormData(); form.append('file', new Blob([bytes], {type:'image/png'}), `nhoytea-${Date.now()}.png`); form.append('upload_preset', preset); form.append('folder', 'nhoytea/googlemaps'); form.append('context', `source=ai;address=${ADDRESS};generated=${new Date().toISOString()}`); const out = await json(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, {method:'POST',body:form}); if (!out.secure_url) throw new Error('Cloudinary did not return secure_url'); return out.secure_url; }
async function createPost(token, locationName, summary, imageUrl) { const m = locationName.match(/^accounts\/([^/]+)\/locations\/([^/]+)$/); if (!m) throw new Error(`Invalid GBP_LOCATION_NAME: ${locationName}`); const [, accountId, locationId] = m; const body = { languageCode:'vi', summary, topicType:'STANDARD', media:[{mediaFormat:'PHOTO', sourceUrl:imageUrl}], callToAction:{actionType:'ORDER', url:orderUrl()} }; return json(`https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/localPosts`, {method:'POST', headers:{authorization:`Bearer ${token}`,'content-type':'application/json'}, body:JSON.stringify(body)}); }

function chooseHour(history) {
  const slots = (env('POSTING_HOURS_LOCAL','18,19,20,21').split(',').map(Number).filter(h => h>=13 && h<=23));
  if (!slots.length) return 19;
  // Official GBP daily metrics are not per-post/hour. So the workflow uses controlled A/B/C/D hour rotation
  // instead of pretending that a daily profile metric identifies the best posting hour.
  return slots[(history.posts?.length || 0) % slots.length];
}
function shouldPostNow(history, now) {
  if (history.lastPostDate === now.date) return false;
  if (env('FORCE_TEST_POST') === '1') return true;
  const allowed = [13,14,15,16,17,18,19,20,21,22,23,0,1,2,3];
  if (!allowed.includes(now.hour)) return false;
  return now.hour === chooseHour(history);
}

async function main() {
  const now = localParts(); const history = await readHistory(); const targetHour = chooseHour(history);
  if (process.env.DRY_RUN === '1') { console.log(JSON.stringify({ok:true,dryRun:true,now,targetHour,shouldPost:shouldPostNow(history,now),hook:pickHook(history),orderUrl:orderUrl()},null,2)); return; }
  if (!shouldPostNow(history, now)) { console.log(`No post at ${now.date} ${now.hour}:00 VN; target=${targetHour}:00.`); return; }
  const token = await googleAccessToken(); const locationName = await getLocation(token); const hook = pickHook(history);
  const body = `${hook}\n\n📍 ${ADDRESS}\n🛍️ Mua mang về tại quán\n🛵 Có thể đặt giao tận nơi qua link ĐẶT HÀNG\n⏰ Mở cửa 13:00–03:00\n\nNếu đang ở gần Âu Cơ, ghé Nhoy Tea lấy một ly nhé.`;
  const image = await generateImage(history); const imageUrl = await uploadCloudinary(image); const post = await createPost(token, locationName, body, imageUrl);
  history.posts.push({date:now.date, hour:now.hour, hook, body, imageUrl, postName:post.name || null, searchUrl:post.searchUrl || null, createdAt:new Date().toISOString()}); history.lastPostDate = now.date; await writeHistory(history);
  console.log(JSON.stringify({ok:true,locationName,postName:post.name,searchUrl:post.searchUrl,imageUrl,body,targetHour},null,2));
}
main().catch(e=>{ console.error(e.stack || e); process.exit(1); });

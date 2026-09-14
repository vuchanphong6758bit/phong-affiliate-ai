const crypto = require("crypto");

function getCookie(req, name) {
  const cookies = req.headers.cookie || "";
  const match = cookies.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

function decryptSession(value, secret) {
  try {
    const [ivText, tagText, encryptedText] = value.split(".");
    if (!ivText || !tagText || !encryptedText || !secret) return null;
    const key = crypto.createHash("sha256").update(secret).digest();
    const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(ivText, "base64url"), key);
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedText, "base64url")),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf8"));
  } catch (error) {
    console.error("TikTok session decrypt error:", error);
    return null;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function getSession(req) {
  const sessionCookie = getCookie(req, "tiktok_session");
  if (!sessionCookie) return null;

  const modeCookie = getCookie(req, "tiktok_oauth_mode");
  let mode = modeCookie === "production" ? "production" : "sandbox";
  let secret = mode === "sandbox" ? process.env.TIKTOK_SANDBOX_CLIENT_SECRET : process.env.TIKTOK_CLIENT_SECRET;
  let session = decryptSession(sessionCookie, secret);

  if (!session) {
    mode = "production";
    secret = process.env.TIKTOK_CLIENT_SECRET;
    session = decryptSession(sessionCookie, secret);
  }

  if (!session) return null;
  if (session.expires_at && Date.now() >= session.expires_at) return null;
  return session;
}

async function getCreatorInfo(accessToken) {
  const response = await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: "{}",
  });
  return { response, data: await response.json() };
}

module.exports = async (req, res) => {
  const session = await getSession(req);
  if (!session) return res.status(401).send("TikTok session không tồn tại hoặc đã hết hạn. Hãy kết nối TikTok lại.");

  try {
    const { response, data } = await getCreatorInfo(session.access_token);
    if (!response.ok || data.error?.code !== "ok") {
      return res.status(400).json({ success: false, message: "Không lấy được Creator Info", error: data });
    }

    const creator = data.data || {};
    const privacyOptions = creator.privacy_level_options || [];

    if (req.method === "GET") {
      const optionsHtml = privacyOptions.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join("");
      return res.status(200).send(`<!doctype html>
<html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Đăng TikTok - Phong Affiliate AI</title>
<style>
body{font-family:Arial,sans-serif;max-width:760px;margin:50px auto;padding:20px}h1{margin-bottom:10px}.account{background:#f5f5f5;padding:16px;border-radius:10px;margin:20px 0;line-height:1.7}label{display:block;font-weight:bold;margin-top:18px;margin-bottom:8px}input,textarea,select{width:100%;box-sizing:border-box;padding:12px;border:1px solid #ccc;border-radius:8px;font-size:15px}textarea{min-height:120px}.check{font-weight:normal;display:flex;gap:10px;align-items:flex-start}.check input{width:auto;margin-top:4px}button{margin-top:24px;width:100%;padding:14px;border:0;border-radius:8px;background:#111;color:white;font-size:16px;cursor:pointer}.note{color:#666;font-size:14px;margin-top:8px}.status{margin-top:20px;padding:15px;border-radius:8px;background:#f5f5f5;white-space:pre-wrap}
</style></head><body>
<h1>Đăng video TikTok</h1>
<div class="account"><strong>Tài khoản TikTok</strong><br>Nickname: ${escapeHtml(creator.creator_nickname)}<br>Username: ${escapeHtml(creator.creator_username)}<br>Thời lượng tối đa: ${escapeHtml(creator.max_video_post_duration_sec)} giây</div>
<form id="postForm">
<label>Video từ máy</label><input id="video" type="file" accept="video/mp4,video/quicktime,video/webm" required><div class="note">Dùng FILE_UPLOAD nên không cần xác minh domain của video.</div>
<label>Caption</label><textarea id="title" maxlength="2200" placeholder="Nhập caption và hashtag..."></textarea>
<label>Quyền riêng tư</label><select id="privacy" required><option value="" selected disabled>-- Chọn quyền riêng tư --</option>${optionsHtml}</select>
<label class="check"><input id="aigc" type="checkbox"><span>Video này được tạo bằng AI</span></label>
<label class="check"><input id="consent" type="checkbox" required><span>Tôi xác nhận nội dung trên và đồng ý gửi video này lên TikTok.</span></label>
<button id="submit" type="submit">Đăng lên TikTok</button>
</form><div id="status" class="status" hidden></div>
<script>
const form=document.getElementById('postForm');const statusBox=document.getElementById('status');const button=document.getElementById('submit');
function show(text){statusBox.hidden=false;statusBox.textContent=text;}
form.addEventListener('submit',async(e)=>{
 e.preventDefault();
 const file=document.getElementById('video').files[0];
 if(!file){show('Chưa chọn video.');return;}
 if(!['video/mp4','video/quicktime','video/webm'].includes(file.type)){show('Video phải là MP4, MOV hoặc WebM.');return;}
 if(file.size>4*1024*1024*1024){show('Video vượt quá 4GB.');return;}
 button.disabled=true;show('1/2 Đang khởi tạo Direct Post...');
 try{
   const init=await fetch('/api/tiktok/post',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:document.getElementById('title').value,privacy_level:document.getElementById('privacy').value,is_aigc:document.getElementById('aigc').checked,consent:document.getElementById('consent').checked,video_size:file.size})});
   const initData=await init.json();
   if(!init.ok||!initData.success){throw new Error(initData.error?.message||initData.message||'TikTok Direct Post initialization failed');}
   show('2/2 Đang tải video lên TikTok...');
   const upload=await fetch(initData.upload_url,{method:'PUT',headers:{'Content-Type':file.type||'video/mp4','Content-Length':String(file.size),'Content-Range':'bytes 0-'+(file.size-1)+'/'+file.size},body:file});
   if(!upload.ok){const text=await upload.text();throw new Error('TikTok upload failed: HTTP '+upload.status+' '+text);}
   show('Đã tải video lên TikTok.\\n\\nPublish ID: '+initData.publish_id+'\\n\\nKiểm tra trạng thái: /api/tiktok/status?publish_id='+encodeURIComponent(initData.publish_id));
 }catch(err){show('LỖI: '+err.message);}finally{button.disabled=false;}
});
</script></body></html>`);
    }

    if (req.method === "POST") {
      let body = req.body || {};
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
      const title = body.title || "";
      const privacyLevel = body.privacy_level;
      const consent = body.consent === true || body.consent === "true";
      const isAigc = body.is_aigc === true || body.is_aigc === "true";
      const videoSize = Number(body.video_size || 0);

      if (!consent) return res.status(400).json({ success:false, message:"Bạn phải xác nhận đồng ý đăng video." });
      if (!privacyLevel) return res.status(400).json({ success:false, message:"Bạn phải chọn privacy_level." });
      if (!videoSize || !Number.isSafeInteger(videoSize) || videoSize <= 0) return res.status(400).json({ success:false, message:"Thiếu hoặc sai video_size." });
      if (!privacyOptions.includes(privacyLevel)) return res.status(400).json({ success:false, message:"privacy_level không nằm trong danh sách TikTok cho phép.", privacy_level_options:privacyOptions });

      const initResponse = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
        method:"POST",
        headers:{Authorization:`Bearer ${session.access_token}`,"Content-Type":"application/json; charset=UTF-8"},
        body:JSON.stringify({post_info:{title:title.slice(0,2200),privacy_level:privacyLevel,disable_duet:creator.duet_disabled===true,disable_comment:creator.comment_disabled===true,disable_stitch:creator.stitch_disabled===true,is_aigc:isAigc,brand_content_toggle:false,brand_organic_toggle:false},source_info:{source:"FILE_UPLOAD",video_size:videoSize,chunk_size:videoSize,total_chunk_count:1}})
      });
      const initData = await initResponse.json();
      console.log("TikTok Direct Post FILE_UPLOAD Init:", initData);
      if(!initResponse.ok || initData.error?.code !== "ok") return res.status(initResponse.status||400).json({success:false,message:"TikTok Direct Post initialization failed",error:initData});
      return res.status(200).json({success:true,publish_id:initData.data?.publish_id,upload_url:initData.data?.upload_url});
    }

    return res.status(405).send("Method Not Allowed");
  } catch(error) {
    console.error("TikTok post error:",error);
    return res.status(500).json({success:false,message:"TikTok Direct Post server error",error:String(error.message||error)});
  }
};

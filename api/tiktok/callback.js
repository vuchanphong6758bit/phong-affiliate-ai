const crypto = require("crypto");
const { saveToken } = require("../../lib/tiktok-store");

function getCookie(req, name) {
  const cookies = req.headers.cookie || "";
  const match = cookies.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

function clean(value) {
  return typeof value === "string" ? value.trim() : value;
}

function encryptSession(data, secret) {
  const key = crypto.createHash("sha256").update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

function esc(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).send("Method Not Allowed");

  const { code, state, error, error_description } = req.query;
  if (error) return res.status(400).send(`TikTok authorization failed: ${esc(error)}${error_description ? ` - ${esc(error_description)}` : ""}`);
  if (!code) return res.status(400).send("Missing authorization code");

  const savedState = getCookie(req, "tiktok_oauth_state");
  if (!state || !savedState || state !== savedState) return res.status(400).send("Invalid OAuth state");

  const mode = getCookie(req, "tiktok_oauth_mode") === "sandbox" ? "sandbox" : "production";
  const clientKey = clean(mode === "sandbox" ? process.env.TIKTOK_SANDBOX_CLIENT_KEY : process.env.TIKTOK_CLIENT_KEY);
  const clientSecret = clean(mode === "sandbox" ? process.env.TIKTOK_SANDBOX_CLIENT_SECRET : process.env.TIKTOK_CLIENT_SECRET);
  if (!clientKey || !clientSecret) return res.status(500).send(`TikTok ${mode} environment variables are missing`);

  const redirectUri = "https://phong-affiliate-ai.vercel.app/api/tiktok/callback";

  try {
    const tokenResponse = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
      body: new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri }).toString(),
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || tokenData.error) {
      console.error("TikTok token exchange failed", { mode, error: tokenData.error, error_description: tokenData.error_description });
      return res.status(400).json({ success: false, message: "TikTok token exchange failed", mode, error: tokenData });
    }

    const creatorResponse = await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenData.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const creatorData = await creatorResponse.json();
    if (!creatorResponse.ok || creatorData.error?.code !== "ok") {
      return res.status(400).json({ success: false, message: "TikTok Creator Info failed", mode, error: creatorData });
    }

    await saveToken({
      mode,
      openId: tokenData.open_id,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      secret: clientSecret,
    });

    const session = encryptSession({
      mode,
      access_token: tokenData.access_token,
      open_id: tokenData.open_id,
      expires_at: Date.now() + Number(tokenData.expires_in || 86400) * 1000,
    }, clientSecret);
    const sessionMaxAge = Math.max(300, Number(tokenData.expires_in || 86400));
    res.setHeader("Set-Cookie", [
      "tiktok_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      "tiktok_oauth_mode=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      `tiktok_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${sessionMaxAge}`,
    ]);

    const creator = creatorData.data || {};
    const privacy = Array.isArray(creator.privacy_level_options) ? creator.privacy_level_options.join(", ") : "N/A";
    return res.status(200).send(`<!doctype html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Phong Affiliate AI - TikTok Connected</title><style>body{font-family:Arial,sans-serif;max-width:700px;margin:70px auto;padding:25px;text-align:center}.info{background:#f5f5f5;padding:20px;border-radius:10px;text-align:left;line-height:1.7}a{display:inline-block;padding:12px 20px;background:#111;color:#fff;text-decoration:none;border-radius:8px;margin:8px}</style></head><body><h1>Đã kết nối TikTok thành công</h1><p>Token đã được lưu an toàn để hệ thống tự động sử dụng.</p><div class="info"><b>Môi trường:</b> ${esc(mode)}<br><b>TikTok Open ID:</b> ${esc(tokenData.open_id || "N/A")}<br><b>Scope:</b> ${esc(tokenData.scope || "N/A")}<br><b>Creator:</b> ${esc(creator.creator_username || "N/A")} — ${esc(creator.creator_nickname || "N/A")}<br><b>Privacy Options:</b> ${esc(privacy)}<br><b>Thời lượng tối đa:</b> ${esc(creator.max_video_post_duration_sec || "N/A")} giây</div><p><a href="/api/tiktok/post">Đăng video TikTok</a><a href="/">Quay lại</a></p></body></html>`);
  } catch (err) {
    console.error("TikTok OAuth error:", err);
    return res.status(500).send("TikTok OAuth server error");
  }
};

const crypto = require("crypto");
const { getToken, updateRefreshedToken } = require("../../lib/tiktok-store");

function timingSafeEqualText(a, b) {
  if (!a || !b) return false;
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function getAutomationKey(req) {
  return req.headers["x-tiktok-automation-key"] || req.headers["x-api-key"] || "";
}

function getMode(req, body) {
  return (body?.mode || req.headers["x-tiktok-mode"] || "sandbox") === "production" ? "production" : "sandbox";
}

function config(mode) {
  return mode === "production"
    ? { clientKey: process.env.TIKTOK_CLIENT_KEY, clientSecret: process.env.TIKTOK_CLIENT_SECRET }
    : { clientKey: process.env.TIKTOK_SANDBOX_CLIENT_KEY, clientSecret: process.env.TIKTOK_SANDBOX_CLIENT_SECRET };
}

async function getFreshAccessToken(mode) {
  const cfg = config(mode);
  if (!cfg.clientKey || !cfg.clientSecret) throw new Error(`TikTok ${mode} client credentials are missing.`);

  const stored = await getToken(mode, cfg.clientSecret);
  if (!stored) throw new Error(`TikTok ${mode} is not connected yet. Open /api/tiktok/auth?mode=${mode} once to authorize the account.`);

  if (stored.accessExpiresAt > Date.now() + 5 * 60 * 1000) return stored.accessToken;

  const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: new URLSearchParams({
      client_key: cfg.clientKey,
      client_secret: cfg.clientSecret,
      grant_type: "refresh_token",
      refresh_token: stored.refreshToken,
    }).toString(),
  });
  const data = await response.json();
  if (!response.ok || data.error || !data.access_token) {
    throw new Error(data.error_description || data.error || "TikTok access token refresh failed.");
  }

  await updateRefreshedToken({
    mode,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || stored.refreshToken,
    expiresIn: Number(data.expires_in || 86400),
    secret: cfg.clientSecret,
  });
  return data.access_token;
}

async function creatorInfo(accessToken) {
  const response = await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  return { response, data: await response.json() };
}

function assertVideoUrl(rawUrl) {
  const parsed = new URL(String(rawUrl));
  if (parsed.protocol !== "https:") throw new Error("video_url phải sử dụng HTTPS.");
  const allowedHosts = [
    "backblazeb2.com",
    "f002.backblazeb2.com",
    "shotstack-api-v1-output.s3-ap-southeast-2.amazonaws.com",
    "github.com",
    "release-assets.githubusercontent.com",
  ];
  const isAllowed = allowedHosts.some(
    (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
  );
  if (!isAllowed) throw new Error("Video host không được phép.");
  return parsed.toString();
}

async function uploadFileToTikTok(accessToken, sourceUrl, creator, body) {
  let videoResponse;
  try {
    videoResponse = await fetch(assertVideoUrl(sourceUrl), {
      redirect: "follow",
      headers: { Accept: "video/mp4,video/*;q=0.9,*/*;q=0.1" },
    });
  } catch (error) {
    throw new Error(`Không tải được video nguồn: ${error.message}`);
  }

  if (!videoResponse.ok) throw new Error(`Không tải được video nguồn: HTTP ${videoResponse.status}.`);

  const mimeType = (videoResponse.headers.get("content-type") || "video/mp4").split(";")[0];
  const buffer = Buffer.from(await videoResponse.arrayBuffer());
  const videoSize = buffer.length;
  if (!videoSize) throw new Error("Video nguồn rỗng.");
  if (videoSize > 64 * 1024 * 1024) {
    throw new Error("Video test hiện vượt 64 MB; cần bật upload theo nhiều chunk trước khi đăng video lớn.");
  }

  const info = await creatorInfo(accessToken);
  if (!info.response.ok || info.data.error?.code !== "ok") {
    return { ok: false, status: info.response.status || 400, data: info.data, message: "TikTok Creator Info failed." };
  }

  const currentCreator = info.data.data || creator;
  const options = currentCreator.privacy_level_options || [];
  if (!body.privacy_level || !options.includes(body.privacy_level)) {
    return { ok: false, status: 400, message: "privacy_level không nằm trong danh sách TikTok cho phép.", privacy_level_options: options };
  }

  const initResponse = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      post_info: {
        title: String(body.title || "").slice(0, 2200),
        privacy_level: body.privacy_level,
        disable_duet: currentCreator.duet_disabled === true,
        disable_comment: currentCreator.comment_disabled === true,
        disable_stitch: currentCreator.stitch_disabled === true,
        is_aigc: body.is_aigc === true,
        brand_content_toggle: false,
        brand_organic_toggle: false,
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: videoSize,
        chunk_size: videoSize,
        total_chunk_count: 1,
      },
    }),
  });

  const initData = await initResponse.json();
  if (!initResponse.ok || initData.error?.code !== "ok" || !initData.data?.upload_url) {
    return { ok: false, status: initResponse.status || 400, data: initData, message: "TikTok Direct Post initialization failed." };
  }

  const uploadUrl = initData.data.upload_url;
  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(videoSize),
      "Content-Range": `bytes 0-${videoSize - 1}/${videoSize}`,
    },
    body: buffer,
  });

  if (!uploadResponse.ok && uploadResponse.status !== 201 && uploadResponse.status !== 206) {
    const uploadText = await uploadResponse.text().catch(() => "");
    return {
      ok: false,
      status: uploadResponse.status || 400,
      message: "TikTok video upload failed.",
      data: { status: uploadResponse.status, body: uploadText.slice(0, 1000) },
    };
  }

  return {
    ok: true,
    data: {
      publish_id: initData.data.publish_id,
      privacy_level: body.privacy_level,
      video_url: sourceUrl,
      transfer_method: "FILE_UPLOAD",
    },
  };
}

async function fetchStatus(accessToken, publishId) {
  const response = await fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ publish_id: publishId }),
  });
  return { response, data: await response.json() };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method Not Allowed" });

  const automationKey = process.env.TIKTOK_AUTOMATION_KEY;
  if (!automationKey) return res.status(500).json({ success: false, message: "TIKTOK_AUTOMATION_KEY is not configured in Vercel." });
  if (!timingSafeEqualText(getAutomationKey(req), automationKey)) return res.status(401).json({ success: false, message: "Invalid automation key." });

  let body = req.body || {};
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const mode = getMode(req, body);

  try {
    const accessToken = await getFreshAccessToken(mode);

    if (body.action === "status") {
      if (!body.publish_id) return res.status(400).json({ success: false, message: "Thiếu publish_id." });
      const result = await fetchStatus(accessToken, body.publish_id);
      if (!result.response.ok || result.data.error?.code !== "ok") return res.status(result.response.status || 400).json({ success: false, message: "Không lấy được trạng thái TikTok.", error: result.data });
      return res.status(200).json({ success: true, mode, publish_id: body.publish_id, status: result.data.data?.status, fail_reason: result.data.data?.fail_reason || null, publicly_available_post_id: result.data.data?.publicaly_available_post_id || [], data: result.data.data });
    }

    if (body.consent !== true) return res.status(400).json({ success: false, message: "consent phải là true." });
    if (!body.video_url) return res.status(400).json({ success: false, message: "Thiếu video_url." });

    const creatorResult = await creatorInfo(accessToken);
    if (!creatorResult.response.ok || creatorResult.data.error?.code !== "ok") {
      return res.status(creatorResult.response.status || 400).json({ success: false, message: "TikTok Creator Info failed.", error: creatorResult.data });
    }
    const creator = creatorResult.data.data || {};
    const result = await uploadFileToTikTok(accessToken, body.video_url, creator, body);
    if (!result.ok) return res.status(result.status || 400).json({ success: false, message: result.message, error: result.data || null, privacy_level_options: result.privacy_level_options });
    return res.status(200).json({ success: true, mode, publish_id: result.data.publish_id, privacy_level: result.data.privacy_level, transfer_method: result.data.transfer_method });
  } catch (error) {
    console.error("TikTok automation error:", error.message);
    return res.status(500).json({ success: false, message: error.message || "TikTok automation server error." });
  }
};

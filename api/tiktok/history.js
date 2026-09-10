const crypto = require("crypto");
const { listPostHistory, savePostHistory } = require("../../lib/tiktok-history-store");

function timingSafeEqualText(a, b) {
  if (!a || !b) return false;
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function getKey(req) {
  return req.headers["x-tiktok-automation-key"] || req.headers["x-api-key"] || "";
}

module.exports = async (req, res) => {
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).json({ success: false, message: "Method Not Allowed" });
  const automationKey = process.env.TIKTOK_AUTOMATION_KEY;
  if (!automationKey) return res.status(500).json({ success: false, message: "TIKTOK_AUTOMATION_KEY is not configured in Vercel." });
  if (!timingSafeEqualText(getKey(req), automationKey)) return res.status(401).json({ success: false, message: "Invalid automation key." });

  try {
    if (req.method === "GET") {
      const rows = await listPostHistory(req.query?.limit);
      return res.status(200).json({ success: true, items: rows });
    }

    let body = req.body || {};
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    if (!body.publish_id) return res.status(400).json({ success: false, message: "Thiếu publish_id." });
    if (!body.status) return res.status(400).json({ success: false, message: "Thiếu status." });

    await savePostHistory({
      mode: body.mode || "sandbox",
      openId: body.open_id,
      publishId: body.publish_id,
      publiclyAvailablePostId: body.publicly_available_post_id,
      title: body.title,
      videoUrl: body.video_url,
      privacyLevel: body.privacy_level,
      status: body.status,
      failReason: body.fail_reason,
    });
    return res.status(200).json({ success: true, publish_id: body.publish_id, status: body.status });
  } catch (error) {
    console.error("TikTok history error:", error.message);
    return res.status(500).json({ success: false, message: error.message || "TikTok history server error." });
  }
};

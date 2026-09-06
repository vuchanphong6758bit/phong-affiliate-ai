const crypto = require("crypto");

function timingSafeEqualText(a, b) {
  if (!a || !b) return false;
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function getKey(req) {
  return req.headers["x-shotstack-automation-key"] || req.headers["x-api-key"] || "";
}

function assertHttpsUrl(rawUrl) {
  const parsed = new URL(String(rawUrl));
  if (parsed.protocol !== "https:") throw new Error("source_url phải sử dụng HTTPS.");
  return parsed.toString();
}

function textClip(text, start, length, position = "center") {
  if (!text || length <= 0) return null;
  const align = position === "top"
    ? { horizontal: "center", vertical: "top" }
    : position === "bottom"
      ? { horizontal: "center", vertical: "bottom" }
      : { horizontal: "center", vertical: "middle" };

  return {
    asset: {
      type: "rich-text",
      text: String(text),
      font: { family: "Montserrat", color: "#FFFFFF", size: 42, weight: 700 },
      align,
      background: { color: "#000000", opacity: 0.65, borderRadius: 12, wrap: true },
    },
    start,
    length,
    width: 900,
    height: 220,
    transition: { in: "fade", out: "fade" },
    position,
  };
}

function buildEdit(body) {
  const sourceUrl = assertHttpsUrl(body.source_url || body.video_url);
  const duration = Math.min(Math.max(Number(body.duration || 30), 15), 60);

  const backgroundVideo = {
    asset: {
      type: "video",
      src: sourceUrl,
      volume: 1,
      trim: 0,
    },
    start: 0,
    length: duration,
    fit: "crop",
    position: "center",
  };

  const overlays = [
    textClip(body.hook, 0, Math.min(4, duration), "top"),
    textClip(body.problem, 4, Math.min(6, Math.max(0, duration - 4)), "center"),
    textClip(body.benefit, 10, Math.min(8, Math.max(0, duration - 10)), "center"),
    textClip(body.proof, 18, Math.min(7, Math.max(0, duration - 18)), "center"),
    textClip(body.cta || "Xem sản phẩm ở link bên dưới", Math.max(0, duration - 5), Math.min(5, duration), "bottom"),
  ].filter(Boolean);

  return {
    timeline: {
      background: "#000000",
      tracks: [
        { clips: overlays },
        { clips: [backgroundVideo] },
      ],
    },
    output: {
      format: "mp4",
      fps: 30,
      size: { width: 1080, height: 1920 },
    },
  };
}

async function shotstackFetch(path, options = {}) {
  const base = process.env.SHOTSTACK_API_BASE || "https://api.shotstack.io/edit/v1";
  return fetch(`${base}${path}`, {
    ...options,
    headers: {
      "x-api-key": process.env.SHOTSTACK_API_KEY,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method Not Allowed" });

  const automationKey = process.env.TIKTOK_AUTOMATION_KEY;
  if (!automationKey) return res.status(500).json({ success: false, message: "TIKTOK_AUTOMATION_KEY is not configured." });
  if (!timingSafeEqualText(getKey(req), automationKey)) return res.status(401).json({ success: false, message: "Invalid automation key." });
  if (!process.env.SHOTSTACK_API_KEY) return res.status(500).json({ success: false, message: "SHOTSTACK_API_KEY is not configured in Vercel." });

  let body = req.body || {};
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }

  try {
    if (body.action === "status") {
      if (!body.render_id) return res.status(400).json({ success: false, message: "Thiếu render_id." });
      const response = await shotstackFetch(`/render/${encodeURIComponent(body.render_id)}`);
      const data = await response.json();
      return res.status(response.ok ? 200 : response.status).json({ success: response.ok, ...data });
    }

    if (!body.source_url && !body.video_url) return res.status(400).json({ success: false, message: "Thiếu source_url." });
    const edit = buildEdit(body);
    const response = await shotstackFetch("/render", { method: "POST", body: JSON.stringify(edit) });
    const data = await response.json();
    if (!response.ok) return res.status(response.status || 400).json({ success: false, error: data });

    return res.status(200).json({
      success: true,
      render_id: data.response?.id || data.id,
      status: data.response?.status || data.status || "queued",
      environment: process.env.SHOTSTACK_API_BASE?.includes("/stage") ? "stage" : "production",
      edit,
    });
  } catch (error) {
    console.error("Shotstack automation error:", error.message);
    return res.status(500).json({ success: false, message: error.message || "Shotstack server error." });
  }
};

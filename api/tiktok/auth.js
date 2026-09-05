const crypto = require("crypto");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).send("Method Not Allowed");
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY;

  if (!clientKey) {
    return res.status(500).send("TIKTOK_CLIENT_KEY is not configured");
  }

  const redirectUri =
    "https://phong-affiliate-ai.vercel.app/api/tiktok/callback";

  // Tạo state để chống giả mạo OAuth request
  const state = crypto.randomBytes(32).toString("hex");

  const scope = "user.info.basic,video.upload,video.publish";

  const params = new URLSearchParams({
    client_key: clientKey,
    response_type: "code",
    scope,
    redirect_uri: redirectUri,
    state,
  });

  // Lưu state vào cookie để callback kiểm tra lại
  res.setHeader(
    "Set-Cookie",
    `tiktok_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
  );

  const authorizeUrl =
    "https://www.tiktok.com/v2/auth/authorize/?" + params.toString();

  res.writeHead(302, {
    Location: authorizeUrl,
  });

  res.end();
};

const crypto = require("crypto");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).send("Method Not Allowed");
  }

  const mode = req.query.mode === "sandbox" ? "sandbox" : "production";

  const clientKey =
    mode === "sandbox"
      ? process.env.TIKTOK_SANDBOX_CLIENT_KEY
      : process.env.TIKTOK_CLIENT_KEY;

  if (!clientKey) {
    return res
      .status(500)
      .send(
        mode === "sandbox"
          ? "TIKTOK_SANDBOX_CLIENT_KEY is not configured"
          : "TIKTOK_CLIENT_KEY is not configured"
      );
  }

  const redirectUri =
    "https://phong-affiliate-ai.vercel.app/api/tiktok/callback";

  // Tạo state chống giả mạo OAuth
  const state = crypto.randomBytes(32).toString("hex");

  const scope = "user.info.basic,video.upload,video.publish";

  const params = new URLSearchParams({
    client_key: clientKey,
    response_type: "code",
    scope,
    redirect_uri: redirectUri,
    state,
  });

  // Lưu state + mode để callback biết đang dùng Sandbox hay Production
 res.setHeader("Set-Cookie", [
  `tiktok_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  `tiktok_oauth_mode=${mode}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
]);

  const authorizeUrl =
    "https://www.tiktok.com/v2/auth/authorize/?" + params.toString();

  res.writeHead(302, {
    Location: authorizeUrl,
  });

  res.end();
};

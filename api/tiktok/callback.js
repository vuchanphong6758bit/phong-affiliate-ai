const crypto = require("crypto");

function getCookie(req, name) {
  const cookies = req.headers.cookie || "";

  const match = cookies.match(
    new RegExp("(?:^|; )" + name + "=([^;]*)")
  );

  return match ? decodeURIComponent(match[1]) : null;
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).send("Method Not Allowed");
  }

  const {
    code,
    state,
    error,
    error_description,
  } = req.query;

  if (error) {
    return res
      .status(400)
      .send(
        `TikTok authorization failed: ${error}${
          error_description ? ` - ${error_description}` : ""
        }`
      );
  }

  if (!code) {
    return res.status(400).send("Missing authorization code");
  }

  const savedState = getCookie(req, "tiktok_oauth_state");

  if (!state || !savedState || state !== savedState) {
    return res.status(400).send("Invalid OAuth state");
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

  if (!clientKey || !clientSecret) {
    return res.status(500).send("TikTok environment variables are missing");
  }

  const redirectUri =
    "https://phong-affiliate-ai.vercel.app/api/tiktok/callback";

  try {
    const body = new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });

    const tokenResponse = await fetch(
      "https://open.tiktokapis.com/v2/oauth/token/",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Cache-Control": "no-cache",
        },
        body: body.toString(),
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || tokenData.error) {
      console.error("TikTok token error:", tokenData);

      return res.status(400).json({
        success: false,
        message: "TikTok token exchange failed",
        error: tokenData,
      });
    }

    // Tạm thời chỉ xác nhận OAuth thành công.
    // Không hiển thị access_token ra trình duyệt.
    console.log("TikTok OAuth successful");

    res.setHeader(
      "Set-Cookie",
      "tiktok_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
    );

    return res.status(200).send(`
      <!DOCTYPE html>
      <html lang="vi">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Phong Affiliate AI</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            max-width: 700px;
            margin: 80px auto;
            padding: 30px;
            text-align: center;
          }

          .success {
            font-size: 22px;
            font-weight: bold;
            margin-bottom: 20px;
          }

          a {
            display: inline-block;
            padding: 12px 20px;
            background: #111;
            color: white;
            text-decoration: none;
            border-radius: 8px;
          }
        </style>
      </head>

      <body>
        <div class="success">
          Đã kết nối TikTok thành công
        </div>

        <p>
          Phong Affiliate AI đã nhận được quyền truy cập từ TikTok.
        </p>

        <a href="/">
          Quay lại Phong Affiliate AI
        </a>
      </body>
      </html>
    `);
  } catch (err) {
    console.error("TikTok OAuth error:", err);

    return res.status(500).send("TikTok OAuth server error");
  }
};

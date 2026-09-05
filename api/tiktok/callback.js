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

  // TikTok trả về lỗi OAuth
  if (error) {
    return res
      .status(400)
      .send(
        `TikTok authorization failed: ${error}${
          error_description ? ` - ${error_description}` : ""
        }`
      );
  }

  // Phải có authorization code
  if (!code) {
    return res.status(400).send("Missing authorization code");
  }

  // Kiểm tra state để chống giả mạo OAuth
  const savedState = getCookie(req, "tiktok_oauth_state");

  if (!state || !savedState || state !== savedState) {
    return res.status(400).send("Invalid OAuth state");
  }

  // Xác định Sandbox hay Production
  const mode = getCookie(req, "tiktok_oauth_mode") || "production";

  const clientKey =
    mode === "sandbox"
      ? process.env.TIKTOK_SANDBOX_CLIENT_KEY
      : process.env.TIKTOK_CLIENT_KEY;

  const clientSecret =
    mode === "sandbox"
      ? process.env.TIKTOK_SANDBOX_CLIENT_SECRET
      : process.env.TIKTOK_CLIENT_SECRET;

  if (!clientKey || !clientSecret) {
    return res
      .status(500)
      .send(
        mode === "sandbox"
          ? "TikTok Sandbox environment variables are missing"
          : "TikTok Production environment variables are missing"
      );
  }

  const redirectUri =
    "https://phong-affiliate-ai.vercel.app/api/tiktok/callback";

  try {
    // Đổi authorization code lấy access token
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
        mode,
        error: tokenData,
      });
    }

    console.log("TikTok OAuth successful:", {
      mode,
      open_id: tokenData.open_id,
      scope: tokenData.scope,
      expires_in: tokenData.expires_in,
    });


    // Kiểm tra Creator Info
const creatorInfoResponse = await fetch(
  "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  }
);

const creatorInfoData = await creatorInfoResponse.json();

console.log("TikTok Creator Info:", creatorInfoData);

if (!creatorInfoResponse.ok || creatorInfoData.error?.code !== "ok") { {
  return res.status(400).json({
    success: false,
    message: "TikTok Creator Info failed",
    mode,
    error: creatorInfoData,
  });
}
    
    // Xóa OAuth cookies sau khi xác thực thành công
    res.setHeader("Set-Cookie", [
      "tiktok_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      "tiktok_oauth_mode=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    ]);

    // Hiển thị kết quả kiểm thử
    return res.status(200).send(`
      <!DOCTYPE html>
      <html lang="vi">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Phong Affiliate AI - TikTok Connected</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            max-width: 700px;
            margin: 80px auto;
            padding: 30px;
            text-align: center;
          }

          .success {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 20px;
          }

          .info {
            background: #f5f5f5;
            padding: 20px;
            border-radius: 10px;
            text-align: left;
            margin: 20px 0;
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

        <div class="info">
          <strong>Môi trường:</strong> ${mode}<br><br>
          <strong>TikTok Open ID:</strong> ${tokenData.open_id || "N/A"}<br><br>
          <strong>Scope:</strong> ${tokenData.scope || "N/A"}<br><br>
          <strong>Access Token:</strong> Đã nhận<br><br>
          <strong>Refresh Token:</strong> Đã nhận
        </div>

        <p>
          Bước tiếp theo: kiểm tra Creator Info và chuẩn bị đăng video.
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

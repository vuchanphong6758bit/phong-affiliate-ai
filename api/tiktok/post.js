const crypto = require("crypto");

function getCookie(req, name) {
  const cookies = req.headers.cookie || "";

  const match = cookies.match(
    new RegExp("(?:^|; )" + name + "=([^;]*)")
  );

  return match ? decodeURIComponent(match[1]) : null;
}

function decryptSession(value, secret) {
  try {
    const [ivText, tagText, encryptedText] = value.split(".");

    if (!ivText || !tagText || !encryptedText) {
      return null;
    }

    const key = crypto
      .createHash("sha256")
      .update(secret)
      .digest();

    const iv = Buffer.from(ivText, "base64url");
    const tag = Buffer.from(tagText, "base64url");
    const encrypted = Buffer.from(
      encryptedText,
      "base64url"
    );

    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      iv
    );

    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString("utf8"));
  } catch (error) {
    console.error("TikTok session decrypt error:", error);
    return null;
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function getSession(req) {
  const sessionCookie = getCookie(
    req,
    "tiktok_session"
  );

  if (!sessionCookie) {
    return null;
  }

  const modeCookie = getCookie(
    req,
    "tiktok_oauth_mode"
  );

  // Ưu tiên mode lưu trong session sau khi decrypt.
  // Cookie mode cũ chỉ là fallback.
  let mode = modeCookie || "sandbox";

  let clientSecret =
    mode === "sandbox"
      ? process.env.TIKTOK_SANDBOX_CLIENT_SECRET
      : process.env.TIKTOK_CLIENT_SECRET;

  let session = decryptSession(
    sessionCookie,
    clientSecret
  );

  // Nếu thử sandbox không được, thử production.
  if (!session) {
    mode = "production";

    clientSecret =
      process.env.TIKTOK_CLIENT_SECRET;

    session = decryptSession(
      sessionCookie,
      clientSecret
    );
  }

  if (!session) {
    return null;
  }

  if (
    session.expires_at &&
    Date.now() >= session.expires_at
  ) {
    return null;
  }

  return session;
}

async function getCreatorInfo(accessToken) {
  const response = await fetch(
    "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    }
  );

  const data = await response.json();

  return {
    response,
    data,
  };
}

module.exports = async (req, res) => {
  const session = await getSession(req);

  if (!session) {
    return res
      .status(401)
      .send(
        "TikTok session không tồn tại hoặc đã hết hạn. Hãy kết nối TikTok lại."
      );
  }

  try {
    /*
     * GET
     * Hiển thị giao diện đăng video.
     */
    if (req.method === "GET") {
      const {
        response,
        data,
      } = await getCreatorInfo(
        session.access_token
      );

      if (
        !response.ok ||
        data.error?.code !== "ok"
      ) {
        console.error(
          "Creator Info failed:",
          data
        );

        return res.status(400).json({
          success: false,
          message: "Không lấy được Creator Info",
          error: data,
        });
      }

      const creator = data.data || {};

      const privacyOptions =
        creator.privacy_level_options || [];

      const optionsHtml = privacyOptions
        .map(
          (option) =>
            `<option value="${escapeHtml(
              option
            )}">${escapeHtml(option)}</option>`
        )
        .join("");

      return res.status(200).send(`
        <!DOCTYPE html>
        <html lang="vi">
        <head>
          <meta charset="UTF-8">
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          >
          <title>Đăng TikTok - Phong Affiliate AI</title>

          <style>
            body {
              font-family: Arial, sans-serif;
              max-width: 760px;
              margin: 50px auto;
              padding: 20px;
            }

            h1 {
              margin-bottom: 10px;
            }

            .account {
              background: #f5f5f5;
              padding: 16px;
              border-radius: 10px;
              margin: 20px 0;
            }

            label {
              display: block;
              font-weight: bold;
              margin-top: 18px;
              margin-bottom: 8px;
            }

            input,
            textarea,
            select {
              width: 100%;
              box-sizing: border-box;
              padding: 12px;
              border: 1px solid #ccc;
              border-radius: 8px;
              font-size: 15px;
            }

            textarea {
              min-height: 120px;
              resize: vertical;
            }

            .consent {
              margin-top: 20px;
              display: flex;
              gap: 10px;
              align-items: flex-start;
            }

            .consent input {
              width: auto;
              margin-top: 4px;
            }

            button {
              margin-top: 24px;
              width: 100%;
              padding: 14px;
              border: 0;
              border-radius: 8px;
              background: #111;
              color: white;
              font-size: 16px;
              cursor: pointer;
            }

            .note {
              color: #666;
              font-size: 14px;
              margin-top: 8px;
            }
          </style>
        </head>

        <body>
          <h1>Đăng video TikTok</h1>

          <div class="account">
            <strong>Tài khoản TikTok</strong><br><br>

            Nickname:
            ${escapeHtml(
              creator.creator_nickname
            )}<br>

            Username:
            ${escapeHtml(
              creator.creator_username
            )}<br><br>

            Thời lượng tối đa:
            ${escapeHtml(
              creator.max_video_post_duration_sec
            )} giây
          </div>

          <form method="POST">

            <label>Video URL</label>

            <input
              type="url"
              name="video_url"
              placeholder="https://..."
              required
            />

            <div class="note">
              Video phải là URL HTTPS công khai.
            </div>

            <label>Caption</label>

            <textarea
              name="title"
              maxlength="2200"
              placeholder="Nhập caption và hashtag..."
            ></textarea>

            <label>Quyền riêng tư</label>

            <select
              name="privacy_level"
              required
            >
              <option value="" selected disabled>
                -- Chọn quyền riêng tư --
              </option>

              ${optionsHtml}
            </select>

            <label>
              <input
                type="checkbox"
                name="is_aigc"
                value="true"
              />
              Video này được tạo bằng AI
            </label>

            <label class="consent">
              <input
                type="checkbox"
                name="consent"
                value="true"
                required
              />

              <span>
                Tôi xác nhận nội dung trên và đồng ý
                gửi video này lên TikTok.
              </span>
            </label>

            <button type="submit">
              Đăng lên TikTok
            </button>

          </form>
        </body>
        </html>
      `);
    }

    /*
     * POST
     * Khởi tạo Direct Post.
     */
    if (req.method === "POST") {
      let body = req.body || {};

      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          body = {};
        }
      }

      const videoUrl = body.video_url;
      const title = body.title || "";
      const privacyLevel = body.privacy_level;
      const consent =
        body.consent === true ||
        body.consent === "true";

      const isAigc =
        body.is_aigc === true ||
        body.is_aigc === "true";

      if (!consent) {
        return res.status(400).json({
          success: false,
          message:
            "Bạn phải xác nhận đồng ý đăng video.",
        });
      }

      if (!videoUrl) {
        return res.status(400).json({
          success: false,
          message: "Thiếu video_url.",
        });
      }

      if (!videoUrl.startsWith("https://")) {
        return res.status(400).json({
          success: false,
          message:
            "video_url phải sử dụng HTTPS.",
        });
      }

      if (!privacyLevel) {
        return res.status(400).json({
          success: false,
          message:
            "Bạn phải chọn privacy_level.",
        });
      }

      /*
       * Luôn lấy Creator Info mới nhất trước khi init.
       */
      const {
        response: creatorResponse,
        data: creatorData,
      } = await getCreatorInfo(
        session.access_token
      );

      if (
        !creatorResponse.ok ||
        creatorData.error?.code !== "ok"
      ) {
        return res.status(400).json({
          success: false,
          message: "Creator Info failed",
          error: creatorData,
        });
      }

      const creator =
        creatorData.data || {};

      const privacyOptions =
        creator.privacy_level_options || [];

      if (
        !privacyOptions.includes(
          privacyLevel
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "privacy_level không nằm trong danh sách TikTok cho phép.",
          privacy_level_options:
            privacyOptions,
        });
      }

      /*
       * Direct Post initialization
       */
      const initResponse = await fetch(
        "https://open.tiktokapis.com/v2/post/publish/video/init/",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type":
              "application/json; charset=UTF-8",
          },
          body: JSON.stringify({
            post_info: {
              title: title.slice(0, 2200),
              privacy_level: privacyLevel,
              disable_duet:
                creator.duet_disabled === true,
              disable_comment:
                creator.comment_disabled === true,
              disable_stitch:
                creator.stitch_disabled === true,
              is_aigc: isAigc,
              brand_content_toggle: false,
              brand_organic_toggle: false,
            },

            source_info: {
              source: "PULL_FROM_URL",
              video_url: videoUrl,
            },
          }),
        }
      );

      const initData =
        await initResponse.json();

      console.log(
        "TikTok Direct Post Init:",
        initData
      );

      if (
        !initResponse.ok ||
        initData.error?.code !== "ok"
      ) {
        return res.status(
          initResponse.status || 400
        ).json({
          success: false,
          message:
            "TikTok Direct Post initialization failed",
          error: initData,
        });
      }

      return res.status(200).send(`
        <!DOCTYPE html>
        <html lang="vi">
        <head>
          <meta charset="UTF-8">
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          >
          <title>Đang đăng TikTok</title>
        </head>

        <body
          style="
            font-family: Arial;
            max-width: 700px;
            margin: 80px auto;
            padding: 20px;
          "
        >

          <h1>Đã gửi video đến TikTok</h1>

          <p>
            TikTok đang xử lý video.
          </p>

          <p>
            <strong>Publish ID:</strong><br>
            ${escapeHtml(
              initData.data?.publish_id
            )}
          </p>

          <p>
            Bước tiếp theo là kiểm tra trạng thái
            publish.
          </p>

          <a
            href="/api/tiktok/status?publish_id=${encodeURIComponent(
              initData.data?.publish_id || ""
            )}"
          >
            Kiểm tra trạng thái
          </a>

        </body>
        </html>
      `);
    }

    return res
      .status(405)
      .send("Method Not Allowed");
  } catch (error) {
    console.error(
      "TikTok post error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "TikTok Direct Post server error",
    });
  }
};

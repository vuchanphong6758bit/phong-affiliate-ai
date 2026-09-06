const crypto = require("crypto");

function getCookie(req, name) {
  const cookies = req.headers.cookie || "";

  const match = cookies.match(
    new RegExp("(?:^|; )" + name + "=([^;]*)")
  );

  return match
    ? decodeURIComponent(match[1])
    : null;
}

function decryptSession(value, secret) {
  try {
    const [ivText, tagText, encryptedText] =
      value.split(".");

    if (
      !ivText ||
      !tagText ||
      !encryptedText
    ) {
      return null;
    }

    const key = crypto
      .createHash("sha256")
      .update(secret)
      .digest();

    const decipher =
      crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(ivText, "base64url")
      );

    decipher.setAuthTag(
      Buffer.from(tagText, "base64url")
    );

    const decrypted = Buffer.concat([
      decipher.update(
        Buffer.from(
          encryptedText,
          "base64url"
        )
      ),
      decipher.final(),
    ]);

    return JSON.parse(
      decrypted.toString("utf8")
    );
  } catch {
    return null;
  }
}

function getSession(req) {
  const cookie = getCookie(
    req,
    "tiktok_session"
  );

  if (!cookie) {
    return null;
  }

  const secrets = [
    {
      mode: "sandbox",
      secret:
        process.env
          .TIKTOK_SANDBOX_CLIENT_SECRET,
    },
    {
      mode: "production",
      secret:
        process.env.TIKTOK_CLIENT_SECRET,
    },
  ];

  for (const item of secrets) {
    if (!item.secret) continue;

    const session = decryptSession(
      cookie,
      item.secret
    );

    if (session) {
      if (
        session.expires_at &&
        Date.now() >= session.expires_at
      ) {
        return null;
      }

      return session;
    }
  }

  return null;
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res
      .status(405)
      .send("Method Not Allowed");
  }

  const session = getSession(req);

  if (!session) {
    return res.status(401).json({
      success: false,
      message:
        "TikTok session không tồn tại hoặc đã hết hạn.",
    });
  }

  const publishId =
    req.query.publish_id;

  if (!publishId) {
    return res.status(400).json({
      success: false,
      message:
        "Thiếu publish_id.",
    });
  }

  try {
    const response = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type":
            "application/json; charset=UTF-8",
        },
        body: JSON.stringify({
          publish_id: publishId,
        }),
      }
    );

    const data =
      await response.json();

    console.log(
      "TikTok Publish Status:",
      data
    );

    if (
      !response.ok ||
      data.error?.code !== "ok"
    ) {
      return res.status(
        response.status || 400
      ).json({
        success: false,
        message:
          "Không lấy được trạng thái TikTok.",
        error: data,
      });
    }

    return res.status(200).json({
      success: true,
      publish_id: publishId,
      status: data.data?.status,
      fail_reason:
        data.data?.fail_reason || null,
      publicly_available_post_id:
        data.data
          ?.publicaly_available_post_id ||
        [],
      data: data.data,
    });
  } catch (error) {
    console.error(
      "TikTok status error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "TikTok status server error.",
    });
  }
};

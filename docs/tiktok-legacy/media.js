export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const rawUrl = req.query?.url;
    if (!rawUrl || typeof rawUrl !== 'string') {
      res.status(400).json({ error: 'Missing url' });
      return;
    }

    let target;
    try {
      target = new URL(rawUrl);
    } catch {
      res.status(400).json({ error: 'Invalid url' });
      return;
    }

    if (target.protocol !== 'https:') {
      res.status(400).json({ error: 'Only HTTPS URLs are allowed' });
      return;
    }

    // The current video generator stores MP4 files on Backblaze B2.
    // Keep this proxy allowlisted to avoid turning the endpoint into an open proxy.
    const allowedHosts = [
      'backblazeb2.com',
      'f002.backblazeb2.com'
    ];
    const hostAllowed = allowedHosts.some(
      (host) => target.hostname === host || target.hostname.endsWith(`.${host}`)
    );

    if (!hostAllowed) {
      res.status(403).json({ error: 'Video host is not allowed' });
      return;
    }

    const upstream = await fetch(target.toString(), {
      redirect: 'follow',
      headers: {
        'Accept': 'video/mp4,video/*;q=0.9,*/*;q=0.1'
      }
    });

    if (!upstream.ok || !upstream.body) {
      res.status(502).json({
        error: 'Unable to fetch source video',
        status: upstream.status
      });
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'video/mp4');
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    const reader = upstream.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    res.end();
  } catch (error) {
    console.error('TikTok media proxy error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Media proxy failed' });
    } else {
      res.end();
    }
  }
}

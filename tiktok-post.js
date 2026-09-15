(() => {
  const video = document.getElementById('video');
  const title = document.getElementById('title');
  const privacy = document.getElementById('privacy');
  const aigc = document.getElementById('aigc');
  const consent = document.getElementById('consent');
  const submit = document.getElementById('submit');
  const status = document.getElementById('status');

  function show(message, isError = false) {
    status.hidden = false;
    status.textContent = message;
    status.className = isError ? 'status error' : 'status';
  }

  async function readJson(response) {
    const text = await response.text();
    try { return text ? JSON.parse(text) : {}; }
    catch { return { raw: text }; }
  }

  async function checkStatus(publishId) {
    for (let i = 0; i < 30; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const response = await fetch(`/api/tiktok/post?mode=sandbox&publish_id=${encodeURIComponent(publishId)}`, {
        credentials: 'same-origin',
        cache: 'no-store'
      });
      const data = await readJson(response);
      if (!response.ok || data.success === false) {
        throw new Error(data.message || data.error?.message || 'Không lấy được trạng thái video.');
      }
      const state = data.status || data.data?.status || 'PROCESSING';
      if (state === 'PUBLISH_COMPLETE') return data;
      if (state === 'FAILED') throw new Error(data.fail_reason || 'TikTok báo đăng video thất bại.');
      show(`TikTok đang xử lý video...\nTrạng thái: ${state}`);
    }
    throw new Error('TikTok chưa trả kết quả sau 60 giây. Bạn có thể kiểm tra lại trạng thái sau.');
  }

  submit.addEventListener('click', async () => {
    if (!video.files || !video.files[0]) return show('Vui lòng chọn video từ máy.', true);
    if (!privacy.value) return show('Vui lòng chọn quyền riêng tư.', true);
    if (!consent.checked) return show('Vui lòng xác nhận đồng ý đăng video.', true);

    const file = video.files[0];
    if (file.size <= 0) return show('File video không hợp lệ.', true);

    submit.disabled = true;
    show('Đang khởi tạo đăng video lên TikTok...');

    try {
      const initResponse = await fetch('/api/tiktok/post?mode=sandbox', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.value || '',
          privacy_level: privacy.value,
          consent: consent.checked,
          is_aigc: aigc.checked,
          video_size: file.size
        })
      });
      const initData = await readJson(initResponse);
      if (!initResponse.ok || !initData.success) {
        throw new Error(initData.message || initData.error_message || initData.error?.message || `Khởi tạo thất bại (HTTP ${initResponse.status}).`);
      }
      if (!initData.upload_url || !initData.publish_id) {
        throw new Error('TikTok không trả về upload_url hoặc publish_id.');
      }

      show('Đang tải video lên TikTok...');
      const uploadResponse = await fetch(initData.upload_url, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type || 'video/mp4',
          'Content-Length': String(file.size),
          'Content-Range': `bytes 0-${file.size - 1}/${file.size}`
        },
        body: file
      });
      if (!uploadResponse.ok) {
        const uploadText = await uploadResponse.text().catch(() => '');
        throw new Error(`Tải video lên TikTok thất bại (HTTP ${uploadResponse.status}). ${uploadText}`.trim());
      }

      show('Video đã tải lên. TikTok đang xử lý...');
      const result = await checkStatus(initData.publish_id);
      show(`Đăng video thành công.\nPublish ID: ${initData.publish_id}${result.publicly_available_post_id?.length ? `\nPost ID: ${result.publicly_available_post_id.join(', ')}` : ''}`);
    } catch (error) {
      console.error('TikTok post client error:', error);
      show(`Không đăng được video.\n${error.message || error}`, true);
    } finally {
      submit.disabled = false;
    }
  });
})();

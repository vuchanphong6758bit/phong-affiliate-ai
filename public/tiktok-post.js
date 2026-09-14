(() => {
  function init() {
    const statusBox = document.getElementById('status');
    const button = document.getElementById('submit');
    const video = document.getElementById('video');
    const privacy = document.getElementById('privacy');
    const consent = document.getElementById('consent');
    const aigc = document.getElementById('aigc');
    const title = document.getElementById('title');
    if (!statusBox || !button || !video || !privacy || !consent || !aigc || !title) return;

    function show(text, error = false) {
      statusBox.hidden = false;
      statusBox.className = error ? 'status error' : 'status';
      statusBox.textContent = text;
    }

    async function checkStatus(publishId, attempt = 1) {
      try {
        const response = await fetch('/api/tiktok/post?publish_id=' + encodeURIComponent(publishId), { credentials: 'same-origin', cache: 'no-store' });
        const text = await response.text();
        let data = {};
        try { data = JSON.parse(text); } catch (_) {}
        if (!response.ok || !data.success) {
          const e = data.error || {};
          const message = e.message || data.message || text || ('HTTP ' + response.status);
          throw new Error(message);
        }
        const status = data.status || 'UNKNOWN';
        if (status === 'PUBLISH_COMPLETE') {
          const postIds = (data.publicly_available_post_id || []).join(', ');
          show('ĐĂNG TIKTOK THÀNH CÔNG\n\nPublish ID: ' + publishId + '\nTrạng thái: ' + status + (postIds ? '\nPost ID: ' + postIds : '));
          return true;
        }
        if (status === 'FAILED') {
          show('TIKTOK ĐĂNG THẤT BẠI\n\nPublish ID: ' + publishId + '\nLý do: ' + (data.fail_reason || 'TikTok không cung cấp lý do.'), true);
          return true;
        }
        show('ĐÃ TẢI VIDEO LÊN TIKTOK\n\nPublish ID: ' + publishId + '\nTrạng thái: ' + status + '\n\nĐang tự kiểm tra trạng thái... (' + attempt + '/20)');
        if (attempt < 20) {
          setTimeout(() => checkStatus(publishId, attempt + 1), 3000);
        } else {
          show('TIKTOK CHƯA HOÀN TẤT XỬ LÝ\n\nPublish ID: ' + publishId + '\nTrạng thái cuối: ' + status + '\n\nCó thể kiểm tra lại bằng cách tải lại trang và dùng Publish ID này.', false);
        }
        return false;
      } catch (error) {
        show('LỖI KHI KIỂM TRA TRẠNG THÁI\n\nPublish ID: ' + publishId + '\n' + (error && error.message ? error.message : String(error)), true);
        return true;
      }
    }

    show('Sẵn sàng. Chọn video và bấm Đăng lên TikTok.');

    button.addEventListener('click', async () => {
      const file = video.files && video.files[0];
      if (!file) return show('LỖI: Chưa chọn video.', true);
      if (!['video/mp4', 'video/quicktime', 'video/webm'].includes(file.type)) return show('LỖI: Video phải là MP4, MOV hoặc WebM.', true);
      if (file.size <= 0 || file.size > 4 * 1024 * 1024 * 1024) return show('LỖI: Kích thước video không hợp lệ.', true);
      if (!privacy.value) return show('LỖI: Chưa chọn quyền riêng tư.', true);
      if (!consent.checked) return show('LỖI: Chưa tick xác nhận đồng ý đăng video.', true);

      button.disabled = true;
      show('1/2 Đang khởi tạo Direct Post...');
      try {
        const init = await fetch('/api/tiktok/post', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.value, privacy_level: privacy.value, is_aigc: aigc.checked, consent: true, video_size: file.size })
        });
        const text = await init.text();
        let data = {};
        try { data = JSON.parse(text); } catch (_) {}
        if (!init.ok || !data.success) {
          const e = data.error || {};
          const nested = e.error || {};
          const code = e.code || nested.code || data.code || '';
          const message = e.message || nested.message || data.message || text || ('HTTP ' + init.status);
          const logId = e.log_id || e.logid || nested.log_id || nested.logid || data.log_id || '';
          throw new Error((code ? 'code=' + code + ' | ' : '') + message + (logId ? ' | log_id=' + logId : '') + (data.http_status ? ' | HTTP=' + data.http_status : ''));
        }
        if (!data.upload_url || !data.publish_id) throw new Error('TikTok không trả về upload_url hoặc publish_id. Phản hồi: ' + text);

        show('2/2 Đang tải video lên TikTok...');
        const xhr = new XMLHttpRequest();
        await new Promise((resolve, reject) => {
          xhr.open('PUT', data.upload_url, true);
          xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
          xhr.setRequestHeader('Content-Range', 'bytes 0-' + (file.size - 1) + '/' + file.size);
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error('TikTok upload failed: HTTP ' + xhr.status + ' ' + xhr.responseText));
          };
          xhr.onerror = () => reject(new Error('Không thể kết nối tới TikTok upload URL (CORS hoặc mạng).'));
          xhr.onabort = () => reject(new Error('Upload bị hủy.'));
          xhr.send(file);
        });
        show('ĐÃ TẢI VIDEO LÊN TIKTOK\n\nPublish ID: ' + data.publish_id + '\n\nĐang kiểm tra trạng thái tự động...');
        await checkStatus(data.publish_id);
      } catch (error) {
        show('LỖI: ' + (error && error.message ? error.message : String(error)), true);
      } finally {
        button.disabled = false;
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

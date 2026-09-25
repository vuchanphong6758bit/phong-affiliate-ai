# Phong Affiliate AI

Workflow tự động nghiên cứu sản phẩm affiliate, chọn sản phẩm có biên hoa hồng kỳ vọng cao hơn chi phí quảng cáo, tạo bài viết bằng AI, xuất bản qua webhook và gửi báo cáo KPI lúc 06:00 mỗi ngày (Asia/Ho_Chi_Minh).

## Luồng chạy

1. 05:00: lấy feed sản phẩm affiliate → tính hoa hồng dự kiến → loại sản phẩm không đạt biên lợi nhuận.
2. AI tạo bài viết mới dựa trên dữ liệu các bài trước.
3. Nếu có `PUBLISH_WEBHOOK_URL`, bài viết được gửi tới hệ thống xuất bản của bạn.
4. Lưu lịch sử để ngày sau AI tiếp tục tối ưu góc nội dung/CTA.
5. 06:00: lấy số liệu Facebook Ads + affiliate metrics và gửi email tới `vuchanphong6758@gmail.com`.

## Cần cấu hình GitHub Actions

Vào **Settings → Secrets and variables → Actions**.

### Secrets

- `OPENAI_API_KEY`
- `LAZADA_AFFILIATE_FEED_URL` — endpoint/feed của nguồn affiliate mà tài khoản của bạn được phép truy cập.
- `PUBLISH_WEBHOOK_URL` — webhook nhận `{title, body, cta, product}` để đăng bài.
- `META_ACCESS_TOKEN`
- `META_AD_ACCOUNT_ID`
- `LAZADA_AFFILIATE_METRICS_URL` — endpoint metrics affiliate của bạn.
- `SMTP_HOST`
- `SMTP_USER`
- `SMTP_PASSWORD`

### Variables

- `OPENAI_MODEL` — mặc định `gpt-5.6`.
- `MIN_EXPECTED_AD_COST_PER_ORDER` — mặc định `25000` VND.
- `MIN_EXPECTED_PROFIT_VND` — mặc định `10000` VND.
- `SMTP_PORT` — mặc định `587`.
- `USD_TO_VND` — mặc định `25000`.

## Quan trọng về Lazada

Không nên scraping trang Lazada để giả lập API. Lazada Open Platform yêu cầu ứng dụng được cấp quyền/API permission phù hợp; API production của Việt Nam dùng `https://api.lazada.vn/rest`. Quyền truy cập dữ liệu phụ thuộc app và authorization. Hãy dùng feed/API affiliate hợp lệ mà tài khoản của bạn được cấp.

## Quan trọng về Facebook Ads

Workflow đọc chi phí quảng cáo từ Meta Marketing API. Việc tạo/chỉnh ngân sách quảng cáo tự động chưa được bật trong bản này; đây là chủ ý để tránh tăng ngân sách ngoài kiểm soát. Có thể bổ sung tầng `budget_guard` với giới hạn ngân sách/ngày và ngưỡng ROAS/CPA.

## Chỉ số email

- Lượt view
- Lượt mua hàng
- Tỷ lệ mua sau view
- Chi phí Facebook Ads
- Tổng hoa hồng
- Lợi nhuận cuối cùng = hoa hồng - chi phí quảng cáo

## Lưu ý

GitHub Actions cron dùng UTC. `22:00 UTC` tương ứng `05:00` và `23:00 UTC` tương ứng `06:00` tại Việt Nam khi UTC+7. GitHub có thể khởi chạy scheduled workflow trễ hơn vài phút.

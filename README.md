# Phong Affiliate AI — Production

Hệ thống Affiliate Lazada duy nhất của dự án. Mục tiêu: lấy dữ liệu affiliate hợp lệ, chọn sản phẩm theo economics, tạo nội dung bằng AI, xuất bản qua kênh được cấu hình, thu thập KPI và dùng dữ liệu lịch sử để tối ưu nội dung.

## Kiến trúc Production

`Lazada Affiliate Feed/API → Product Normalization → Economics → AI Content → Publishing → KPI → Learning`

Chỉ một workflow Production được phép chạy tự động. Không tạo workflow Affiliate thứ hai trong repository này.

## Trạng thái hiện tại

- Có connector cho Lazada affiliate feed.
- Có scoring economics.
- Có AI content engine hiện hữu.
- Có lưu lịch sử và KPI.
- Có kiểm tra cấu hình Production.
- Chưa tự động tăng ngân sách quảng cáo.
- Không scraping Lazada.

## Cấu hình bắt buộc

GitHub → Settings → Secrets and variables → Actions:

- `OPENAI_API_KEY`
- `LAZADA_AFFILIATE_FEED_URL` — feed/API affiliate hợp lệ được tài khoản của bạn cấp quyền.

## Cấu hình xuất bản

- `PUBLISH_WEBHOOK_URL`

Nếu chưa có webhook, hệ thống không được coi là đã hoàn thành khâu xuất bản.

## Cấu hình KPI

Một trong hai nguồn cần có:

- `LAZADA_AFFILIATE_METRICS_URL`
- `META_ACCESS_TOKEN` + `META_AD_ACCOUNT_ID`

## Variables

- `OPENAI_MODEL` — mặc định `gpt-5.6`.
- `MIN_EXPECTED_AD_COST_PER_ORDER` — mặc định `25000` VND.
- `MIN_EXPECTED_PROFIT_VND` — mặc định `10000` VND.
- `MAX_PRODUCTS_PER_RUN` — mặc định `5`.

## Nguyên tắc an toàn

1. Production không tự sửa code.
2. Không tự tăng ngân sách quảng cáo.
3. Không tạo workflow trùng lặp.
4. Chỉ dùng Lazada API/feed được cấp quyền.
5. Mọi thay đổi lớn phải qua version/commit và có thể rollback.

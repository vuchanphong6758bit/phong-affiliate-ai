# Phong Affiliate AI — Facebook × Shopee

## Mục tiêu
Hệ thống gồm dashboard + database + AI scoring + AI content + lịch chạy GitHub Actions + Facebook publisher.

## 1. Biến môi trường bắt buộc
Trên Vercel:
- `DATABASE_URL`: Neon Postgres connection string
- `OPENAI_API_KEY`: OpenAI API key
- `OPENAI_MODEL`: model dùng cho content/scoring (có thể để mặc định)
- `FB_PAGE_ID`: Facebook Page ID
- `FB_PAGE_ACCESS_TOKEN`: Page access token có quyền đăng bài
- `FB_GRAPH_VERSION`: phiên bản Graph API; nếu bỏ trống dùng giá trị trong code

GitHub Actions cần tối thiểu:
- `DATABASE_URL`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (không bắt buộc)

## 2. Shopee
Ở giai đoạn đầu, hệ thống nhận `product_url` và `affiliate_url` từ dashboard. Điều này tránh giả định về API Affiliate của Shopee. Khi tài khoản/khả năng API hoặc report của bạn được xác định, có thể thay adapter dữ liệu mà không đổi phần AI/content/Facebook.

## 3. Luồng hiện tại
1. Thêm sản phẩm Shopee.
2. AI chấm điểm.
3. Nếu TEST, AI tạo hook + script + caption.
4. Content được lưu trong database.
5. Facebook publisher có endpoint riêng để đăng bài link khi bạn đã cấu hình Page token.
6. GitHub Actions chạy hằng ngày để chấm và tạo content cho sản phẩm mới/hold.

## 4. Lưu ý
- Không lưu API key trong GitHub code.
- Chưa bật auto-publish hàng loạt. Nên test một vài bài trước.
- Affiliate disclosure và nội dung phải tuân thủ chính sách Shopee/Facebook.

# FB + Shopee Affiliate WF

Workflow này độc lập với workflow TikTok hiện có.

## Luồng
1. Đọc `data/shopee-products.csv`.
2. Chọn sản phẩm READY có affiliate URL và chấm điểm.
3. Gemini tạo bài Facebook.
4. Facebook Page API đăng bài có link.
5. Lưu kết quả vào `data/runs/`.

## Kết nối một lần
GitHub → Settings → Secrets and variables → Actions → New repository secret:

- `GEMINI_API_KEY`: Gemini API key.
- `FACEBOOK_PAGE_ID`: ID Facebook Page cần đăng.
- `FACEBOOK_PAGE_ACCESS_TOKEN`: Page Access Token có quyền đăng bài.

## Thêm sản phẩm
Sửa `data/shopee-products.csv` theo các cột:

`product_id,product_name,price,commission_pct,rating,orders,affiliate_url,category,status`

Chỉ sản phẩm có `status=READY` và có `affiliate_url` mới được chọn.

## Chạy
GitHub → Actions → **FB + Shopee Affiliate** → Run workflow.

Lịch mặc định: 09:00 giờ Việt Nam mỗi ngày.

## Lưu ý
- Không commit API key/token vào repository.
- Workflow hiện không giả định Shopee có Affiliate API công khai.
- Khi tài khoản Shopee có cách lấy link/report tự động, chỉ cần thay lớp dữ liệu Shopee; phần AI/Facebook giữ nguyên.

#!/usr/bin/env python3
"""Adaptive runner: learn from historical CONTENT metrics, then run the daily agent."""
import json
import re
import statistics
import pfai_daily as app


def norm(v):
    return re.sub(r'[^a-z0-9]', '', str(v or '').strip().lower())


def num(v):
    if v is None or str(v).strip() == '':
        return None
    s = str(v).strip().replace(',', '').replace('%', '')
    try:
        return float(s)
    except Exception:
        return None


def first_value(row, aliases):
    wanted = {norm(x) for x in aliases}
    for k, v in row.items():
        if norm(k) in wanted and str(v).strip() != '':
            return v
    return None


def build_learning_context():
    session = app.google_auth()
    if not session:
        return 'HỌC TỪ KẾT QUẢ: Chưa có quyền ghi/đọc dữ liệu riêng; không được giả định có dữ liệu hiệu quả.'

    title = app.sheet_title_from_gid(session, app.TAB_IDS['CONTENT'], 'CONTENT')
    values = app.sheets_values(session, title, app.TAB_IDS['CONTENT'])
    rows = app.rowdicts(values)
    if not rows:
        return 'HỌC TỪ KẾT QUẢ: Chưa có lịch sử CONTENT đủ dữ liệu. Hãy ưu tiên thử nghiệm đa dạng và ghi nhận kết quả.'

    metrics = {
        'views': ['Views', 'View_Count', 'View Count', 'Lượt xem', 'Views_Count'],
        'likes': ['Likes', 'Like_Count', 'Like Count', 'Lượt thích'],
        'comments': ['Comments', 'Comment_Count', 'Lượt bình luận'],
        'shares': ['Shares', 'Share_Count', 'Lượt chia sẻ'],
        'clicks': ['Clicks', 'Click_Count', 'Product_Clicks', 'Link_Clicks', 'Lượt click'],
        'orders': ['Orders', 'Order_Count', 'Purchases', 'Sales_Count', 'Đơn hàng', 'Lượt mua'],
        'commission': ['Commission', 'Commission_VND', 'Estimated_Commission', 'Hoa hồng', 'Hoa_Hong'],
        'gmv': ['GMV', 'GMV_VND', 'Sales_VND', 'Doanh thu'],
        'watch': ['Average_Watch_Time', 'Avg_Watch_Time', 'Watch_Time', 'Thời gian xem TB'],
        'completion': ['Completion_Rate', 'Video_Completion_Rate', 'Tỷ lệ xem hết'],
    }

    enriched = []
    for r in rows:
        m = {k: num(first_value(r, a)) for k, a in metrics.items()}
        if any(v is not None for v in m.values()):
            enriched.append((r, m))

    if not enriched:
        return (
            'HỌC TỪ KẾT QUẢ: Chưa tìm thấy cột số liệu hiệu quả (Views/Likes/Clicks/Orders/Commission/GMV/Watch/Completion) '
            'trong CONTENT. Không được giả vờ đã học. Hiện tại chỉ dùng tín hiệu thị trường; khi số liệu được ghi vào CONTENT, '
            'hãy tự động dùng chúng cho các lần sau.'
        )

    def avg(key):
        vals = [m[key] for _, m in enriched if m[key] is not None]
        return statistics.mean(vals) if vals else None

    lines = [f'HỌC TỪ KẾT QUẢ: Có {len(enriched)} nội dung đã có ít nhất một chỉ số hiệu quả.']
    for k in metrics:
        a = avg(k)
        if a is not None:
            lines.append(f'- Trung bình {k}: {a:.2f}')

    maxes = {}
    for key in ('views', 'likes', 'comments', 'shares', 'clicks', 'orders', 'commission', 'gmv'):
        vals = [m[key] for _, m in enriched if m[key] is not None and m[key] >= 0]
        maxes[key] = max(vals) if vals else 0

    scored = []
    for r, m in enriched:
        score = 0.0
        used = 0.0
        weights = {'orders': 0.35, 'commission': 0.25, 'clicks': 0.15, 'views': 0.10, 'likes': 0.05, 'comments': 0.03, 'shares': 0.02}
        for k, w in weights.items():
            if m[k] is not None and maxes[k] > 0:
                score += w * (m[k] / maxes[k])
                used += w
        if used:
            scored.append((score / used, r, m))

    scored.sort(key=lambda x: x[0], reverse=True)
    winners = scored[:5]
    if winners:
        lines.append('Nội dung/ sản phẩm đang thắng theo dữ liệu thực tế:')
        for s, r, m in winners:
            name = first_value(r, ['Product', 'Product_Name', 'Tên sản phẩm', 'Name']) or '?'
            hook = first_value(r, ['Hook', 'HOOK']) or ''
            title = first_value(r, ['Title', 'Tiêu đề']) or ''
            category = first_value(r, ['Category', 'Danh mục']) or ''
            lines.append(f'- {name} | category={category} | score={s:.3f} | orders={m.get("orders")} | commission={m.get("commission")} | views={m.get("views")} | hook={hook[:120]} | title={title[:120]}')

    cat_scores = {}
    for s, r, m in scored:
        cat = first_value(r, ['Category', 'Danh mục']) or 'unknown'
        cat_scores.setdefault(str(cat), []).append(s)
    if cat_scores:
        ranked_cats = sorted(((statistics.mean(v), k, len(v)) for k, v in cat_scores.items()), reverse=True)[:5]
        lines.append('Danh mục có tín hiệu tốt: ' + '; '.join(f'{k} ({s:.3f}, n={n})' for s, k, n in ranked_cats))

    lines.append('Quy tắc tối ưu lần sau:')
    lines.append('- Tăng xác suất chọn sản phẩm/cách diễn đạt có bằng chứng tạo đơn hoặc hoa hồng; không tối ưu chỉ theo lượt xem.')
    lines.append('- Giữ khoảng 20-30% thử nghiệm sản phẩm/góc nội dung mới để tránh học lệch vào một trend ngắn hạn.')
    lines.append('- Nếu dữ liệu mỏng hoặc thiếu đơn/hoa hồng, không kết luận thắng/thua; ưu tiên thu thập thêm dữ liệu.')
    return '\n'.join(lines)


def main():
    learning = build_learning_context()
    print(learning)
    original = app.gemini

    def learned_gemini(prompt, attempts=2):
        enhanced = prompt + '\n\n--- BỘ NHỚ HỌC TỪ HIỆU QUẢ CÁC LẦN TRƯỚC ---\n' + learning + '\n--- HẾT BỘ NHỚ ---\n'
        try:
            return original(enhanced, attempts=attempts)
        except Exception as primary_error:
            previous_model = app.MODEL
            try:
                app.MODEL = 'gemini-3.1-flash-lite'
                print(f'GEMINI PRIMARY FAILED: {primary_error}')
                print('GEMINI FALLBACK: retrying with gemini-3.1-flash-lite to preserve workflow continuity.')
                return original(enhanced, attempts=1)
            finally:
                app.MODEL = previous_model

    app.gemini = learned_gemini

    # Production safety switch: the daily affiliate workflow must never silently
    # fall back to TikTok sandbox. Keep SELF_ONLY because TikTok restricts
    # unaudited Direct Post clients to private viewing.
    original_pick = app.pick
    def production_pick(row, *names):
        normalized = {norm(n) for n in names}
        if 'mode' in normalized or 'tiktokmode' in normalized:
            return 'production'
        if 'privacylevel' in normalized:
            return 'SELF_ONLY'
        return original_pick(row, *names)
    app.pick = production_pick

    app.main()


if __name__ == '__main__':
    main()

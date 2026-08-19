# Sổ Tra Từ

Trang tra từ vựng Anh–Việt dựng từ sổ từ vựng cá nhân: **1.395 mục · 2.183 nghĩa · 425 ví dụ · 33 bài đọc**.

Gõ tiếng Anh hoặc tiếng Việt — trang tìm trong cả từ, phiên âm, definition và nghĩa,
và tiếng Việt không dấu vẫn ra (`thoai vi` → *abdicate*).

| Phím | Việc |
| --- | --- |
| `/` | nhảy vào ô tìm kiếm |
| `↑` `↓` | đi trong danh sách |
| `Enter` | mở mục đang chọn |
| `Esc` | xoá ô tìm kiếm |

## Hai bản, khác nhau ở chỗ lưu từ mới

| | `docs/index.html` (GitHub Pages) | `so-tra-tu.html` (Artifact claude.ai) |
| --- | --- | --- |
| Ai xem được | bất kỳ ai có link | người bạn chia sẻ |
| Tra cứu | đầy đủ | đầy đủ |
| Thêm / xoá từ | được, lưu trong trình duyệt người xem | được, lưu lên máy chủ cho mọi người |
| Sao lưu `.json` | được | được |

Bản Artifact tự publish lại chính nó mỗi lần thêm hoặc xoá từ, nên từ mới còn nguyên
khi mở ở máy khác. Bản tĩnh không có máy chủ, nên từ ai người nấy giữ — dùng nút
**Sao lưu .json** nếu muốn giữ lâu dài.

## Cấu trúc

```
app.css          giao diện
app.js           toàn bộ ứng dụng (không framework, không phụ thuộc ngoài)
dataset.json     dữ liệu đã bóc từ Google Sheet
parse_sheet.py   bản xuất Google Sheet  ->  dataset.json
build.py         dataset.json + app.css + app.js  ->  hai trang hoàn chỉnh
docs/index.html  bản web tĩnh, GitHub Pages phục vụ thư mục này
```

Mỗi trang là **một tệp HTML duy nhất** — dữ liệu, CSS và JS nhúng sẵn bên trong.
Không có bước bundling, không tải gì từ ngoài trừ font Google.

## Dựng lại

```sh
python build.py          # sau khi sửa app.css hoặc app.js
python parse_sheet.py    # chỉ khi sheet gốc đổi (cần bản xuất mới của sheet)
```

`build.py` chỉ đọc `dataset.json`, nên sửa giao diện xong chạy một lệnh là xong.

## Deploy

GitHub Pages đọc thẳng thư mục `docs/` trên nhánh `main` — không cần build trên CI.
Sửa xong thì `python build.py`, commit, push, vài chục giây sau trang đã đổi.

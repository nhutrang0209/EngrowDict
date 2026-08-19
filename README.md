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
| Tra cứu | 1.395 mục đầy đủ | 1.395 mục đầy đủ |
| 33 bài đọc | không kèm | có |
| Thêm / xoá từ | được, lưu trong trình duyệt người xem | được, lưu lên máy chủ cho mọi người |
| Sao lưu `.json` | được | được |

Bản Artifact tự publish lại chính nó mỗi lần thêm hoặc xoá từ, nên từ mới còn nguyên
khi mở ở máy khác. Bản tĩnh không có máy chủ, nên từ ai người nấy giữ — dùng nút
**Sao lưu .json** nếu muốn giữ lâu dài.

Bản công khai bỏ hẳn phần bài đọc: đó là nguyên văn bài của TED-Ed và BBC, giữ trong
sổ riêng thì được nhưng đăng lên web mở thì thành phát tán lại nội dung có bản quyền.
Khi `readings` rỗng, trang tự bỏ luôn tab **Bài đọc**.

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

## Kiểm tra

```sh
cd test && npm install && npm test
```

57 phép kiểm chạy trên một DOM giả (jsdom), phủ bốn mặt: tra cứu và bàn phím,
vòng tự-publish của bản Artifact (thêm từ → trang tự sinh HTML thay thế → nạp lại
→ từ vẫn còn), bản tĩnh lưu vào `localStorage` và sống sót qua lần tải sau, và
bản công khai không lọt câu nào của bài đọc. Chạy sau mỗi lần `python build.py`.

## Deploy

GitHub Pages đọc thẳng thư mục `docs/` trên nhánh `main` — không cần build trên CI.
Sửa xong thì `python build.py`, commit, push, vài chục giây sau trang đã đổi.

# Sổ Tra Từ

Trang tra từ vựng Anh–Việt dựng từ sổ từ vựng cá nhân trên Google Sheet:
**11.401 mục · 21.050 nghĩa · 2.340 ví dụ · 33 bài đọc**.

Gõ tiếng Anh hoặc tiếng Việt — trang tìm trong cả từ, phiên âm, definition và
nghĩa, và tiếng Việt không dấu vẫn ra (`mui dat` → *petrichor*). Không có
framework, không phụ thuộc ngoài; danh sách 11 nghìn mục dựng theo kiểu cuộn ảo
nên chỉ vài chục dòng nằm trong DOM một lúc.

| Phím | Việc |
| --- | --- |
| `/` | nhảy vào ô tìm kiếm |
| `↑` `↓` | đi trong danh sách |
| `←` `→` | mục trước / mục sau |
| `Esc` | xoá ô tìm kiếm |

## Hai bản, khác nhau ở chỗ lưu từ mới

| | `docs/` (GitHub Pages) | `so-tra-tu.html` (Artifact claude.ai) |
| --- | --- | --- |
| Ai xem được | bất kỳ ai có link | người bạn chia sẻ |
| Tra cứu | 11.401 mục đầy đủ | 11.401 mục đầy đủ |
| 33 bài đọc | không kèm | có |
| Thêm / xoá từ | được, lưu trong trình duyệt người xem | được, lưu lên máy chủ cho mọi người |
| Dữ liệu | `data.json` tải riêng | nhúng sẵn trong tệp |

Bản Artifact tự publish lại chính nó mỗi lần thêm hoặc xoá từ, nên từ mới còn
nguyên khi mở ở máy khác. Bản tĩnh không có máy chủ, nên từ ai người nấy giữ —
dùng nút **Sao lưu .json** nếu muốn giữ lâu dài.

Bản công khai bỏ hẳn phần bài đọc: đó là nguyên văn bài của TED-Ed và BBC, giữ
trong sổ riêng thì được nhưng đăng lên web mở thì thành phát tán lại nội dung có
bản quyền. Khi `readings` rỗng, trang tự bỏ luôn nút **Bài đọc**.

## Đồng bộ từ Google Sheet bằng một nút

`sheet-sync.gs` là Apps Script gắn vào chính file sheet. Nó đọc cả sheet, dựng
lại `docs/data.json` và ghi đè thẳng vào repo qua GitHub API — GitHub Pages dựng
lại sau vài chục giây, không phải chạy build gì trên máy.

**Cài một lần**

1. Mở sheet → **Tiện ích mở rộng → Apps Script**, xoá nội dung mẫu, dán toàn bộ
   `sheet-sync.gs` vào, bấm lưu.
2. Tạo token tại **github.com/settings/personal-access-tokens** → *Fine-grained*,
   chọn đúng repo này, quyền **Contents: Read and write**.
3. Tải lại sheet. Menu **Sổ Tra Từ** hiện ra → **Cài đặt kho GitHub**, dán
   `chu-tai-khoan/ten-repo` và token.

**Từ đó về sau:** sửa sheet → **Sổ Tra Từ → Đồng bộ lên web**. Muốn xem thử
trước thì dùng **Xem thử số liệu (không đẩy)**.

Nút Đồng bộ chỉ cập nhật bản GitHub Pages. Bản Artifact muốn theo kịp thì chạy
`python parse_sheet.py && python build.py` rồi publish lại `so-tra-tu.html`.

## Thêm từ trên web, ghi thẳng vào sheet

Chiều ngược lại đi qua cùng một Apps Script, nhưng dưới dạng Web App: trang web
POST từ mới lên, script chèn vào đúng tab, đúng vị trí a→z, đúng định dạng mà
sheet đang dùng (ô đầu dòng là `từ (từ loại)` xuống dòng `/phiên âm/`, mỗi nghĩa
một dòng, dòng sau bỏ trống ô đầu).

**Cài một lần**

1. Trong Apps Script: **Triển khai → Bản triển khai mới → Ứng dụng web**,
   "Người có quyền truy cập" chọn **Bất kỳ ai**, rồi Triển khai.
2. Về sheet: **Sổ Tra Từ → Link cho web ghi từ vào sheet** — hiện ra link Web App
   và một mã khoá.
3. Mở web, bấm nút **⚙** trên thanh đầu trang, dán link sheet, link Web App và mã
   khoá vào, bấm **Kiểm tra kết nối** rồi **Lưu**.

Từ đó ô **Ghi thẳng vào sheet** hiện trong form thêm từ, mặc định bật. Từ nào
chưa vào được sheet thì hiện nhãn *Chưa vào sheet*, và thanh đầu trang mọc nút
**Ghi N từ vào sheet** để đẩy lại.

**Vì sao phải dán thủ công thay vì nhúng sẵn vào trang:** trang web là công khai,
nhúng link Web App vào đó nghĩa là bất kỳ ai mở trang cũng ghi được vào sheet của
bạn. Cài đặt chỉ nằm trong `localStorage` của trình duyệt bạn dùng, không nằm
trong repo, không nằm trong `data.json`. Người khác vẫn tra cứu và thêm từ bình
thường — từ họ thêm chỉ nằm trong máy họ.

Đường này chỉ chạy ở **bản web tĩnh**. Bản Artifact trên claude.ai bị chặn không
cho gọi ra ngoài, nên hộp Cài đặt ở đó chỉ nói rõ điều này.

## Cấu trúc

```
source.xlsx      bản tải về của Google Sheet — nguồn gốc
parse_sheet.py   source.xlsx  ->  dataset.json
build.py         dataset.json + app.css + app.js  ->  hai bản trang
app.css          giao diện
app.js           toàn bộ ứng dụng
sheet-sync.gs    Apps Script: sheet  ->  docs/data.json (bản JS của parse_sheet.py)
docs/            thư mục GitHub Pages phục vụ
  index.html       vỏ trang, ~60 KB
  data.json        dữ liệu công khai, ~3,9 MB
```

## Dựng lại

```sh
python build.py          # sau khi sửa app.css hoặc app.js
python parse_sheet.py    # khi source.xlsx đổi (tải lại sheet về dạng .xlsx)
```

## Kiểm tra

```sh
cd test && npm install && npm test
```

117 phép kiểm chạy trên một DOM giả (jsdom), phủ bảy mặt:

1. dữ liệu bóc ra đủ A–Z, đúng cấu trúc, không sót rác định dạng
2. tra cứu, lọc, lật chữ cái, đi tới/lui, cuộn ảo
3. vòng tự-publish của bản Artifact: thêm từ → trang tự sinh HTML thay thế →
   nạp lại → từ vẫn còn
4. bản tĩnh tải `data.json`, lưu vào `localStorage`, sống sót qua lần tải sau
5. bản công khai không lọt câu nào của bài đọc
6. `sheet-sync.gs` và `parse_sheet.py` bóc ra dữ liệu giống hệt nhau từng chữ —
   phép kiểm quan trọng nhất, vì hai bản viết bằng hai ngôn ngữ khác nhau
7. đường ghi ngược web → sheet: Settings lưu link đúng chỗ, thêm từ gửi đúng nội
   dung, sheet từ chối thì không mất từ; và phía Apps Script chèn vào đúng tab,
   đúng vị trí a→z — kiểm bằng cách bóc lại chính sheet đã bị chèn

Phép kiểm 6 và 7 cần `test/grids.json`, do `parse_sheet.py` sinh ra; thiếu tệp đó
thì phép 6 tự bỏ qua.

Google thật không bị đụng tới trong lúc test: `SpreadsheetApp` và `fetch` đều là
đồ giả. Riêng việc triển khai Web App và chuyện CORS thì phải thử trên máy thật
bằng nút **Kiểm tra kết nối**.

## Deploy

GitHub Pages đọc thẳng thư mục `docs/` trên nhánh `main` — không cần CI. Sửa
xong thì `python build.py`, commit, push. Còn khi chỉ đổi nội dung sheet thì
dùng nút Đồng bộ, khỏi đụng tới repo.

# books/

The quick way to add a book is the **Add a book** button in the Books tab of
the page itself: pick a PDF or an EPUB and it is read in the browser, kept in
that browser's storage, and readable straight away. It stays on that device.

This folder is the other way, for putting a book on the site so every device
has it. Drop a PDF or an EPUB in here and run:

    python import_books.py books/your-book.pdf

It writes `books/out/<slug>.json` — the book split into chapters, with the
running headers, page numbers and drop capitals taken out and the hyphenated
line breaks put back together. Nothing in this folder is committed.

To put a book on the site, where every one of your devices can read it without
signing in to anything:

    python import_books.py --publish books/your-book.pdf

That writes to `docs/books/` instead, which is published with the page. Use it
for books that are out of copyright — Project Gutenberg and the like. `docs/`
is served to anyone who has the address, so a book still in copyright belongs
in `books/out/` and nowhere else.

The page reads `books/index.json` when it opens and the text of a book only
when you open a chapter of it, so a shelf of ten books costs nothing until you
read one. Once you have read a chapter it is in the phone's cache, and it is
there on the underground too.

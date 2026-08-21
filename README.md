# EngrowDict

An English–Vietnamese vocabulary notebook built from a personal Google Sheet:
**11,401 entries · 21,050 senses · 2,340 examples · 33 reading passages**.

Type English or Vietnamese — the search covers the word, its phonetics, the
English definition and the Vietnamese meaning, and Vietnamese without tone marks
works too (`mui dat` finds *petrichor*). No framework, no outside dependencies;
the 11k-entry list is virtualised, so only a few dozen rows are ever in the DOM.

| Key | Does |
| --- | --- |
| `/` | jump to the search box |
| `↑` `↓` | move through the list |
| `←` `→` | previous / next entry |
| `Esc` | clear the search box |

## Two builds, differing in where new words go

| | `docs/` (GitHub Pages) | `engrowdict.html` (claude.ai Artifact) |
| --- | --- | --- |
| Who can see it | anyone with the link | whoever you share it with |
| Lookup | all 11,401 entries | all 11,401 entries |
| 33 reading passages | included | included |
| Adding / removing words | yes, kept in the visitor's browser | yes, stored on the server |
| Data | `data.json`, fetched separately | embedded in the file |

The artifact republishes itself whenever a word is added or removed, so new
words are still there when it is opened on another machine. The static build has
no server, so each visitor keeps their own — use **Back up .json** to hold on to
them.

## Layout

The list column can be dragged wider or narrower by its divider, nudged with the
arrow keys once the divider has focus, and folded away entirely with the chevron
on it. Folding takes the list and the letter rail with it and leaves whatever you
were reading in place. Both the width and the folded state are remembered per
browser.

A passage runs the full width of the column, capped at 1400px so the lines do not
run away on a very large screen. Dictionary entries keep a narrower measure.

## Reading passages

Both builds carry the 33 passages. Open **Passages** in the top bar, pick one,
and select any word or phrase in it: a card opens with what the notebook holds
on it — headword, part of speech, phonetics, the Vietnamese meanings — and a
button through to the full entry.

**Look up** in the top bar (or the `d` key) floats a dictionary window over the
passage: type to look a word up — headwords only, ranked and marked the way the
Dictionary tab does it, so what starts with what you typed comes first — pick a
result to read its senses,
drag it out of the way, and open the full entry when you want it. Selecting text
while it is open feeds the selection straight into it rather than opening the
small card. It stays where you drag it, and closes when you leave the tab.

The notebook is advanced vocabulary, so ordinary running words are often not in
it. When there is no entry, the card falls back to machine translation, English
to Vietnamese, and names the source it used so it is never mistaken for your own
material. Google's endpoint is tried first and MyMemory stands behind it; a link
out to Google Translate is always offered as well.

MyMemory was the only source at first and it was the wrong choice: it is a
translation memory rather than a translator, so a single word comes back as the
nearest segment some human once translated — *imprisonment* returned *sợ bỏ tù*,
the fear of it. Google's `translate_a/single` is undocumented and may stop
answering without notice, which is why the fallback and the link are kept. That fallback needs the open web, so it works on the
published site and not inside the claude.ai artifact.

The passages are the verbatim text of TED-Ed and BBC articles. They ship in the
public build at the owner's request; to take them back out, set `public` in
`build.py` to carry an empty `readings` list and the page drops its **Passages**
button on its own.

## The passcode

Adding words is behind a passcode, **229922** by default. Enter it under **⚙ →
Unlock**; once unlocked you can change it, and **Lock again** puts it back. The
unlocked state and the passcode live in that browser's `localStorage`, so every
new visitor starts locked with the default.

This guards the interface, not the data — anyone who reads the page source can
find the default passcode. What actually protects the sheet is that the sync
link and key below never ship inside the page.

## Publishing the sheet to the web with one button

`sheet-sync.gs` is an Apps Script attached to the sheet itself. It reads the
whole workbook, rebuilds `docs/data.json` and writes it straight into the repo
through the GitHub API — GitHub Pages redeploys within a minute, with no build
step on your machine.

**Set up once**

1. In the sheet: **Extensions → Apps Script**, clear the sample, paste all of
   `sheet-sync.gs` in, save.
2. Create a token at **github.com/settings/personal-access-tokens** →
   *Fine-grained*, pick this repo, permission **Contents: Read and write**.
3. Reload the sheet. An **EngrowDict** menu appears → **Set up GitHub repo**,
   then paste `owner/name` and the token.

**From then on:** edit the sheet → **EngrowDict → Publish to the web**. To look
before you leap, use **Preview the counts (no upload)**.

This only updates the GitHub Pages build. To bring the artifact up to date, run
`python parse_sheet.py && python build.py` and publish `engrowdict.html` again.

## Adding words on the web, straight into the sheet

The other direction goes through the same Apps Script, deployed as a Web App:
the page posts the new word up, and the script inserts it into the right tab, in
alphabetical order, in the format the sheet already uses — the head cell being
`word (pos)` then `/phonetics/` on the next line, one row per sense, with the
first cell left empty on the rows that follow.

**Set up once**

1. In Apps Script: **Deploy → New deployment → Web app**, "Who has access" set
   to **Anyone**, then Deploy.
2. Back in the sheet: **EngrowDict → Link for the web to write words** — it
   shows the Web App link and a key.
3. On the site press **⚙**, unlock with the passcode, press **Edit** beside each
   field, paste the sheet link, the Web App link and the key, then **Test
   connection** and **Save**.

**Moving to another workbook** is only the first of those three: paste the new
Google Sheet link into **⚙** and Save. Every request carries that link and the
script writes to the workbook it names, so the deployment, the key and the
GitHub token — all of which belong to the script project rather than to a sheet
— stay exactly as they are. The **EngrowDict** menu inside a sheet always means
the sheet it lives in, whatever the site happens to be pointed at. Opening a
workbook by link needs a wider permission than opening the one the script is
attached to, so Google asks to authorise the script once more the first time.

A word written back is styled to match the ones already in the sheet: the
headword bold, blue and hyperlinked to its Cambridge entry, the part of speech
and phonetics plain beneath it, column A merged across a multi-sense entry, a
dashed rule between senses and solid lines everywhere else. Styling is applied
after the values are written, so a formatting failure is reported rather than
allowed to lose the word.

From then on the add-word form carries a **Write straight into the sheet** tick,
on by default. Anything that has not made it into the sheet is badged *Not in
the sheet*, and the top bar grows a **Write N words to sheet** button.

### Fill from Cambridge

The add-word form has an **Auto Fill** button. Type the word, press it,
and the part of speech, the phonetics, the definitions, the examples and the
Vietnamese come back filled in — then you read them over and press **Save word**
yourself. Nothing is written until you do.

**It does not hold the form.** A lookup takes as long as Cambridge and the
model take, and there is no reason to watch it happen. The form is a card:
**Hide** puts it on the rail down the right-hand side with its lookup still
going, **Add word** opens another over the top of it — the one it was opened
over goes to the rail by itself — and pressing a card on the rail brings it
back, fields, word and whatever arrived while it was away. Two lookups run at a
time and the rest wait in line, since each is its own request to the same Apps
Script. The rail says which is which: *looking up…*, *in line*, *ready*, *no
luck*, *draft*.

The form is shown without a backdrop for exactly that reason — the rail beside
it and the Add word button above it have to stay live while it is open. It is
dragged by its head like any other window and pulled about by its four edges
and four corners; two taps on the head put it back in the middle at the size it
started, and where it was left is where the next card off the rail opens. Given
a size of its own it becomes a column — head and foot keep what they need and
the senses take the rest, so a taller form shows more senses rather than more
white. **Hide**
keeps the card — the × and Escape do the same — **Cancel** throws it away and
calls off the lookup with it, and saving a word opens the next card that came
back. Writing to the sheet is somebody else's server and can be hidden the same
way: the rail says *writing to the sheet…* while it goes, the card leaves the
rail when the sheet answers, and the line at the bottom says which word went
in. The Vietnamese box is ticked
to begin with, being the column the notebook is kept for; the examples box is
not. Nothing survives a reload: the rail is a few minutes of impatience, not
state.

Cambridge answers a plain server-side request with **403** (Cloudflare wants a
browser — the entry pages and `robots.txt` alike), so the script reads the page
through `r.jina.ai`, which renders it and returns Cambridge's own markup. Two
pages per word, fetched together: the English dictionary for everything except
the last column, and the English–Vietnamese one for that. Only the Advanced
Learner's entry is read — the page stacks the Academic and Business dictionaries
underneath, and taking all three would fill the form with the same sense written
three ways. A word Cambridge has no entry for at all falls
through to **Merriam-Webster**, which answers a plain request but prints its own
respelling rather than IPA; the form says when that happened.

**The Vietnamese column.** Cambridge's English–Vietnamese dictionary is much the
smaller of the two, so most senses arrive with that column empty. What fills it:

1. Cambridge's own Vietnamese, where the word is in that dictionary.
2. Otherwise **a model**, asked for the gloss a learner would write down — one
   to five words, not a translation of the wording — with the sheet's own
   entries shown to it as the house style. Turn it on with **EngrowDict → Key
   for the Vietnamese column** in the sheet; without a key, step 3. Three kinds
   of key work: one beginning `sk-ant-` goes to Claude, one beginning `sk-` to
   OpenAI, and anything else is taken to be a Google key and goes to
   **Gemini** — Google has changed that shape once already, from `AIza…` to
   `AQ.…`, and a prefix test that refused the newer one is why only the two
   promised prefixes are tested for. The same menu item asks for a model name
   where the default is not the one you can use. Gemini is the one to start
   with if none of this is to be paid for: an AI Studio key costs nothing up to
   a daily limit, which a notebook filled a word at a time is unlikely to
   reach. The key is kept in the script's own properties, so the public page
   never sees it.
3. Otherwise `LanguageApp` (Google Translate), cut back to a gloss. Accurate, but
   it reads like a translation: *abaft* comes out "ở phía sau hoặc bên hông tàu
   hoặc thuyền" where Claude writes "ở phía đuôi tàu".

The form says which of the three wrote each draft's Vietnamese, and a key that
fails costs you the gloss, not the draft. That one line under the form carries
the state in its colour: amber while it is looking, green when a draft came
back, red when neither dictionary had the word.

Without a key, step 3 translates the definition and leaves it at that. It reads
like a translation — *abaft* arrives as "ở phía sau hoặc bên hông tàu hoặc
thuyền" — but it is at least the meaning, and you can trim it in the form.
Translating the headword instead was tried and dropped: it gave "sau", which is
shorter and wrong. Condensing a definition into "phía sau (tàu / thuyền)" is a
judgement, and that is what the key buys.

The reader is free and needs no account. If it starts answering **429**, put a
key from jina.ai in the script property `SOTRATU_READER` for a private rate
limit.

**Why the links are pasted rather than shipped:** the site is public, so putting
the Web App link into the page would let anyone who opens it write to your
sheet. The settings sit in your browser's `localStorage` only — not in the repo,
not in `data.json`. Everyone else can still look words up and add their own;
theirs simply stay on their own machine.

This path only works on the **static build**. The claude.ai artifact is not
allowed to call out to other sites, and its Settings box says so.

## Layout

```
source.xlsx      the Google Sheet, downloaded — the origin of everything
parse_sheet.py   source.xlsx  ->  dataset.json
build.py         dataset.json + app.css + app.js  ->  both builds
app.css          the interface
app.js           the whole application
sheet-sync.gs    Apps Script: sheet -> docs/data.json, and web -> sheet
docs/            what GitHub Pages serves
  index.html       the shell, ~78 KB
  data.json        the public data, ~3.9 MB
```

## Rebuilding

```sh
python build.py          # after editing app.css or app.js
python parse_sheet.py    # when source.xlsx changes (download the sheet as .xlsx)
```

## Tests

```sh
cd test && npm install && npm test
```

283 checks against a fake DOM (jsdom), across twelve areas:

1. the data pulled from the sheet covers a–z, has the right shape, and carries
   no leftover formatting junk
2. search, filters, the letter rail, prev/next, and the virtual list
3. the passcode gate and the Edit buttons in Settings
4. the artifact's self-publish loop: add a word → the page writes its own
   replacement HTML → load it back → the word is still there
5. the static build fetching `data.json`, saving to `localStorage`, and
   surviving a reload
6. the passages, and the card that opens over a selection — notebook hit,
   inflected form, phrasal verb inside a sentence, machine-translation fallback
   and what happens when the translator cannot be reached
7. `sheet-sync.gs` and `parse_sheet.py` reading identical data, character for
   character — the most important check, since the two are written in different
   languages
8. the web → sheet path from both ends: Settings holding the link, the right
   body being posted, a refusal not losing the word, and Apps Script inserting
   into the right tab in the right alphabetical place — verified by reading the
   patched sheet back
9. the Sync button, both when it can republish and when it can only hand the
   entries back for the visit
10. the styling of rows written into the sheet: merged head cell, linked
    headword, dotted rule between senses, nothing drawn into unused columns
11. the list column dragging, folding and being remembered, and a passage
    keeping the full width while folded
12. the floating dictionary: searching, ranking, the selection feeding it,
    dragging, and it belonging to the reading tab

Checks 7 and 8 need `test/grids.json`, which `parse_sheet.py` writes; without it
check 7 skips itself.

Google is never touched while testing: `SpreadsheetApp` and `fetch` are both
stand-ins. Deploying the Web App, and CORS, can only be confirmed on the real
thing — that is what the **Test connection** button is for.

## Books

A whole book is not a passage. It is too big to ship inside the page and too
long to read in one screen, so it is split into chapters and fetched a book at
a time.

There are two ways in. **Add a book** in the Books tab takes a PDF or an EPUB
straight from the browser: the file is read where it is picked — nothing is
uploaded anywhere — and the book is kept in that browser's own storage, so it
is on the device it was added on and no other. Beside the button is **Put it on
the site too**, which sends the same book to `docs/books/` in this repo, and
from there every device has it; a book already on a device gets there the same
way with **Save to the site**, on its contents page. Both need a GitHub token,
and how to get one is under *Books for every device* in Settings.
`import_books.py --publish` does the same two writes from a terminal.

    pip install pymupdf
    python import_books.py books/your-book.pdf            # -> books/out/
    python import_books.py --publish books/your-book.pdf  # -> docs/books/

`import_books.py` reads PDF and EPUB alike and undoes what a page layout does:
the running header repeated on every page, the page number, the drop capital
that comes out of the text layer as a letter standing on its own, and the words
broken in half by a line ending. Chapters come from the book's own table of
contents where it has one, and from its headings where it does not — and only
from headings that are headings: `"SEIZE HIM!"` is a line of the story, not a
chapter title, and all-caps is no evidence either way.

It writes one JSON file per book plus an `index.json`, the shelf. The page reads
the shelf when it opens — a few hundred bytes — and the text of a book only when
a chapter is opened, so a shelf of ten books costs nothing until one is read. A
chapter is then a passage like any other: same prose, same select-a-word-to-look-
it-up, and the service worker keeps it for reading with no signal.

`bookify.js` is the same reasoning again in the browser, for the Add a book
button — with one extra job, because pdf.js hands over loose runs of glyphs
rather than paragraphs, so runs have to be gathered into lines and lines into
paragraphs first. `test/make_layout_pdf.py` draws a PDF that does all of the
awkward things at once, and both importers are held to the same result on it.
pdf.js is vendored in `docs/vendor/`, 1.8 MB that is fetched only when a file is
actually picked.

`books/` is not committed. `--publish` writes to `docs/books/`, which is served
with the site to anyone who has the address, so it is for books that are out of
copyright; a personal copy of one that is not belongs in `books/out/`, or in
the browser through the Add a book button.

### Putting a book up from the page

The tick beside **Add a book** writes those same two files — the book, then the
shelf that names it — over the GitHub API, so a book picked on the phone is on
the laptop as well. What it needs is a fine-grained token with **Contents: read
and write** on this repo, pasted into Settings → *Books for every device*. The
token is kept in this browser exactly as the sheet key is: it never ships inside
the page, so nobody else who opens the address can write to the repo. The repo
itself is worked out from the address the page is served from; the field beside
the token is only for a custom domain, which says nothing about what is behind
it.

The book goes up before the shelf, so the shelf never names a file that is not
there yet. Nothing is ever written over by accident: the repo is asked what it
holds first, and a book of that name already up there stops the send and says
so. Replacing it is a second press — **Replace on the site**, on the contents
page of the book — because a second copy of a book is usually a better scan of
it and sometimes a worse one, and only the person looking at it knows which.

A book that was added before the token was, or added with the tick clear, is
not stranded: open it and **Save to the site** sends the copy in this browser's
storage, no file to pick again. The button reads the shelf the site published,
so it says *Save to the site* for a book only this device has and *Replace on
the site* for one every device has.

GitHub Pages then takes a minute to publish the commit, and an installed copy is
cache-first, so a phone that already has the page may show yesterday's shelf once
and the new book the next time it is opened. The tick is off every time: `docs/`
is public, and putting a book there is a decision worth making on purpose rather
than by leaving a box ticked.

### The top bar while reading

Under 760px the bar wraps to three lines — tabs, buttons, search — over the
column of text the page was opened for. So reading down folds it away and
turning back brings it out, the way a reading app does. It is a negative
margin rather than a transform: the bar takes its space with it, or the
passage would be read through the gap where it used to be. The first screenful
keeps the bar whatever the thumb does, a few pixels of wobble decide nothing,
and changing tab or stepping back to the list puts it back. Wide enough for one
line, none of this happens.

## Installing it on a phone

The static copy is a PWA: `docs/manifest.webmanifest`, `docs/sw.js` and three
PNG icons beside `index.html` are all it takes. On iPhone, **Share → Add to Home
Screen**; Android's Chrome offers its own Install button. iOS shows no prompt of
its own, so the page puts a one-line hint under the top bar for an iPhone that
is not already running the installed copy — dismissed once, dismissed for good.

Installed, it opens full screen with no address bar, and the service worker
takes `index.html` and `data.json` in on install, so **the whole dictionary
works with no signal**. Only Auto Fill and Sync need the network. The worker
leaves alone anything that is not a same-origin GET, and anything with a query
string — which is how `data.json?ts=…` after a Sync gets through to the network
rather than being answered from the cache.

`sw.js` is generated by `build.py` from `sw-template.js`, stamped with a hash of
`index.html` + `data.json`. A deploy that changes neither leaves the phone's copy
where it is; one that changes either replaces it whole. `make_icons.py` draws the
icons — iOS masks the corners itself, so what is drawn is a plain square.

There is a second reason to install rather than bookmark: Safari clears a
website's `localStorage` after seven days of not being opened, and the Web App
link, the key and any words not yet pushed to the sheet live there. An installed
PWA is exempt.

## Deploying

GitHub Pages serves `docs/` on the `main` branch directly — no CI. After editing,
run `python build.py`, commit and push. When only the sheet's contents change,
the Publish button handles it without touching the repo.

## Pushing the Apps Script from the command line

The sheet's script project is managed with [clasp](https://github.com/google/clasp),
so `sheet-sync.gs` does not have to be pasted in by hand after the first setup.
`appsscript/.clasp.json` already points at the bound project.

```sh
npm install -g @google/clasp
clasp login                              # one browser consent, once per machine
cp sheet-sync.gs appsscript/Code.js      # Code.js is generated, not committed
cd appsscript && clasp push -f
clasp redeploy <deploymentId> -d "EngrowDict web write endpoint"
```

`clasp list-deployments` prints the id. Use **redeploy** rather than a fresh
`clasp deploy`, so the Web App link stays the same and nothing has to be pasted
into Settings again.

Two things clasp cannot do, because they are consent screens inside your own
Google account: granting the script its scopes the first time, and revealing the
key. Both happen together the first time you use **EngrowDict → Link for the web
to write words** from the sheet.

Careful with `clasp create`: it overwrites the local `appsscript.json` with a
default that has no `webapp` block, which silently turns the deployment into
something that answers 404. Put the block back and push again before deploying.

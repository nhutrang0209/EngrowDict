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
| 33 reading passages | left out | included |
| Adding / removing words | yes, kept in the visitor's browser | yes, stored on the server |
| Data | `data.json`, fetched separately | embedded in the file |

The artifact republishes itself whenever a word is added or removed, so new
words are still there when it is opened on another machine. The static build has
no server, so each visitor keeps their own — use **Back up .json** to hold on to
them.

The public build drops the reading passages: they are the verbatim text of
TED-Ed and BBC articles, which is fine in a private notebook but not on an open
website. With `readings` empty, the page drops its **Passages** button too.

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

From then on the add-word form carries a **Write straight into the sheet** tick,
on by default. Anything that has not made it into the sheet is badged *Not in
the sheet*, and the top bar grows a **Write N words to sheet** button.

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

145 checks against a fake DOM (jsdom), across eight areas:

1. the data pulled from the sheet covers a–z, has the right shape, and carries
   no leftover formatting junk
2. search, filters, the letter rail, prev/next, and the virtual list
3. the passcode gate and the Edit buttons in Settings
4. the artifact's self-publish loop: add a word → the page writes its own
   replacement HTML → load it back → the word is still there
5. the static build fetching `data.json`, saving to `localStorage`, and
   surviving a reload
6. not one sentence of the reading passages reaching the public build
7. `sheet-sync.gs` and `parse_sheet.py` reading identical data, character for
   character — the most important check, since the two are written in different
   languages
8. the web → sheet path from both ends: Settings holding the link, the right
   body being posted, a refusal not losing the word, and Apps Script inserting
   into the right tab in the right alphabetical place — verified by reading the
   patched sheet back

Checks 7 and 8 need `test/grids.json`, which `parse_sheet.py` writes; without it
check 7 skips itself.

Google is never touched while testing: `SpreadsheetApp` and `fetch` are both
stand-ins. Deploying the Web App, and CORS, can only be confirmed on the real
thing — that is what the **Test connection** button is for.

## Deploying

GitHub Pages serves `docs/` on the `main` branch directly — no CI. After editing,
run `python build.py`, commit and push. When only the sheet's contents change,
the Publish button handles it without touching the repo.

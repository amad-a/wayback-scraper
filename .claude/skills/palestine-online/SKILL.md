---
name: palestine-online
description: How to work on this repo (palestineonline.net, a Win98/IE-style shell over archived 1990s–2000s Palestinian websites). Use for deploying, rebuilding the database, scraping pages from the Wayback Machine, removing archived pages, tags, frames and framesets, the shell's frame protections, and testing changes in a real browser.
---

# Palestine Online

A Win98/IE-style browser shell (`public/`) that shows archived websites (`sites/`) in an iframe (`#frame`). It is served by `src/serve.js` on 8080 (public) and 8081 (admin, loopback only). Data lives in `archive.db`, built from `sites/**/log.json` plus `tags.csv`.

## Working agreement

- Build and test locally first, then ask **"Should I commit, push and deploy?"**. Deploy only on a yes, or when the request itself says "commit, push and deploy".
- `sequence.md` is the user's own working file. Never stage or commit it.
- End commit messages with the `Co-Authored-By` line the session asks for.
- Report what was verified, and where: local or production, and in which browser.

## Commands

| Task | Command |
|---|---|
| Local server | `npm run serve` (restart after changing `src/serve.js`; files under `public/` need no restart) |
| Rebuild DB | `npm run db` (keeps `page_meta`; rows edited on the site, i.e. with `updated_at` set, are not overwritten by `tags.csv`) |
| Archive index | `npm run index` (rebuilds `archive-index.html`; edit `src/build-index.js`, not the output) |
| Media restore | `npm run media` (RealAudio etc. → mp3/mp4; writes `media-manifest.json`) |
| Pull site tags | `npm run tags:pull` (tunnel to the server's 8081 first; see `palindex` in `~/.zshrc`) |
| Deploy | `ssh deploy@167.233.141.19 '~/wayback-scraper/scripts/deploy.sh'` |
| DB on server | `ssh deploy@167.233.141.19 'cd ~/wayback-scraper && npm run db'` (needed after any change to `sites/`, `log.json`, the build-db code or `tags.csv`; `deploy.sh` does not run it) |

`deploy.sh` pulls with `--ff-only`, runs `npm ci` if the lockfile changed, restarts PM2 process `wayback`, and runs a health check. Look for `deploy OK: <sha>`.

The `deploy` user has no passwordless sudo. nginx, ufw and DNS changes (Hetzner DNS console) have to be done by the user at their own terminal: write out the exact commands, then verify once they say it's done. See `DEPLOYMENT.md`.

## Scraping (`src/cdx-scraper.js`)

- Whole site or folder: `npm run scrape -- birzeit.edu/aff 2000 2001`. Writes `<root>/log.json`, downloads pages and assets, then runs the rewrite pass over the **whole** corpus.
- **One page**: `npm run scrape -- birzeit.edu/web/history.html 1997`. Uses the exact URL, takes the earliest capture in range, and adds an entry to the nearest crawl above it that has a `log.json`. If there isn't one, the page's own folder becomes the crawl, e.g. `maxpages.com/rudy`. Add `--overwrite` to replace an existing entry.
  - An address without a file extension, or a folder's index, needs `--page`: `npm run scrape -- maxpages.com/rudy/Home 20011124163705 --page`, or `geocities.com/imadhajjo/ … --page`.
  - To take one particular capture, pass its timestamp as the bound, e.g. from a `web.archive.org/web/<timestamp>/<url>` link.
  - A frameset's frames are added to the log with it, so `npm run db` knows them.
- `<base href>` is honoured: relative references resolve against it, both when downloading and when rewriting. MaxPages members' pages point at `http://maxpages.com/`.
- Assets are found in HTML attributes, inline `style`, `<style>` blocks, image-like strings in inline scripts (FrontPage `MSFPpreload` hover buttons), and stylesheets' own `url(...)`/`@import` (FrontPage `_themes/` backgrounds and bullets). Stylesheets are rescanned from disk on a rerun, so rerunning an older crawl over its existing log fills these in.
- Relink only, no network: `node src/cdx-scraper.js <root> --rewrite-only`.
- When several captures save to one file (`folder/` and `folder/index.html`, or two spellings of a path), the crawl reads each and keeps one (`pickCapture`, logged with 🔀): never a redirect, directory listing or "moved" notice if a real page exists, then the most visible text. Logs written before this may still hold both; the Birzeit log was fixed by hand.
- Local file names drop the query string, so `doc.mhtml?i=1` and `doc.mhtml?i=2` would collide. Give such log entries an explicit `localPath` (e.g. `thenation.com/doc.mhtml__i-20020506-s-said.html`); `build-db` and the rewrite pass use it in place of the derived path. Point the linking page's hrefs at those files by hand.
- After any scrape: review `git status -- sites` before committing. The rewrite pass touches every page, so check that the diff contains only what was intended:
  - `data-wayback-url` is only ever **added** to pages missing it, never replaced. Adding it is fine.
  - Links to `.ram`, `.rm` and `.ra` files always stay dead. `npm run media` points restorable links at `.mp3` instead.
  - `geocities.com/zuhairhm/...` and other badly nested pages can reshuffle on every pass. Restore them with `git checkout HEAD -- <file>` if they show up in the diff for no reason -- but a change that isn't the rewrite pass's doing (a hand-added `style`, a fixed tag) may be the user's own edit: ask before reverting.
  - A Flash `<object>`/`<embed>` whose `.swf` was never saved gets `class="dead-flash"` (hidden, keeping its space), and a page with no playable movie left loses its Ruffle tags. Both are recomputed each pass, like dead links.
- Then run `npm run db`, and `npm run index` if the archive index should change.
- A site's capture list is fetched from CDX in pages (`showNumPages`, then `&page=N`), each saved to `<site>/cdx-pages.json` as it arrives, so a stopped crawl resumes. The page count covers every year of the site, so most pages come back empty. Don't commit `cdx-pages.json`.
- GeoCities pages captured as 302 (the member moved away) are filtered out by `statuscode:200`. If a year yields almost nothing, list all years with `collapse=urlkey` to see where the 200s are.
- The Wayback Machine rate-limits by IP and returns 429 with no `Retry-After`. The scraper pauses all 8 workers for 90s. If you get blocked for a long time, email info@archive.org; don't move scraping to another IP.

## Removing archived pages

Example: keeping only five pages of `geocities.com/zuhairhm`.

1. Work out the keep set: the pages to keep, plus every local file they reference (`src`, `background`, `href` to non-pages, CSS/JS, and anything those reference in turn), plus the crawl's `log.json`.
2. Delete everything else in that crawl with `git rm` (pass file names NUL-separated: some names contain quotes). Then run `find … -type d -empty -delete`.
3. Trim `log.json` to the kept pages. `build-db` only knows pages that are listed in a log.
4. Run `node src/cdx-scraper.js <root> --rewrite-only`, so links to the removed pages go dead everywhere.
5. Run `npm run db` and `npm run index`. Remove `media-manifest.json` entries whose files are gone.
6. Check tags first, both locally and on the server: `page_meta` on the server is the authoritative copy (`updated_at` marks rows edited on the site).
7. Verify: search returns only the kept pages, removed pages return 404, and kept pages have no newly broken images. Compare against `git show HEAD:<file>` to tell pre-existing breakage from new.

## Tags and entries

- Writes are accepted only on the admin port 8081 (loopback, never proxied by nginx). Requests must be same-origin JSON. There are no secrets in pages.
- `tags.csv` is the committed backup. The server's DB is the latest copy; `npm run tags:pull` brings it down.
- The `entry` tag drives the address bar ▼ list and the random start page (a bare `/` opens a random entry page).
- `title_override` fixes mis-decoded titles, including Arabic.

## Frames and framesets

`npm run db` computes `frame_home` and `frame_slot` for each page: the frameset it belongs in, and which frame inside it (`frameHomes` in `src/build-db.js`). It follows each crawl's links out from its framesets:

- frame `src` attributes; named targets; plain links inherit their frame; Flash `getURL` targets, read from the `.swf` bytecode; FrontPage `<frame target>`.
- A stripped `<base>` means links default to the frameset's largest frame. The scraper strips `<base target>`.
- Empty `<a>` tags are ignored. These are Dreamweaver's "URLs used in the movie" lists placed next to Flash movies.
- A page reachable from a standalone page (one something links to, or the crawl's front page) stays standalone.
- The boundary is one crawl root, so one Angelfire or GeoCities account at a time.

The shell (`public/app/api.js`) then opens every framed page inside its frameset:

- `openPlaced` and `/api/place` handle the address bar, search, favorites, history, Random and `?p=`. For `?p=` the server writes a `data-place` attribute.
- `paneFor` and `/api/frameset` route untargeted pane links to the right frame.
- A catch-all swaps a bare framed page for its frameset.
- The address bar and `?p=` follow the last pane navigated.

To check data changes: build into a scratch DB with `node src/build-db.js --db <scratch>/x.db --tags tags.csv`, then diff `frame_home`/`frame_slot` against a previous build. Look at samples per site, and at pages landing in menu-like frames (`nav`, `menu`, `header`, `left`, `contents`).

## Keeping the archive inside the frame

Every route out of the frame is handled. Before changing the sandbox, the CSP or the click handling, re-run the escape tests.

- **Sandbox** on `#frame`: `allow-same-origin allow-scripts allow-forms allow-popups allow-modals`. Keep `allow-modals`: the Print button needs it. A sandboxed pane can't navigate a sibling frame, so scripted navigation goes through shell code:
  - `shellOpen` replaces `window.open`;
  - `framePortal` stands in for `parent.<name>` and `parent.frames['name']`.
  - A parked plan to drop the sandbox in favour of the Navigation API lives in Claude's project memory (`sandbox-removal-plan`).
- **Server** (`src/serve.js`):
  - a `/sites` page requested with `Sec-Fetch-Dest: document` is redirected to `/?p=`;
  - navigating to a file the browser can't show returns an HTML notice instead of a download;
  - archived files are sent with `ARCHIVE_CSP` (same-site only; inline scripts and eval allowed);
  - the shell is sent with `frame-src 'self'`;
  - pages the database lists, and server-side extensions (`.asp`, `.php`, `.cgi`, `.pl`), are typed by content, not extension.
- **Shell**:
  - live-web and `mailto:` links are blocked;
  - `_blank` and unknown targets open in the frame;
  - `window.open` only works from a click, and opens into the frame;
  - live-web navigations are cancelled through each frame's `navigation`;
  - `history.back()` stops at the start of the visit;
  - dialogs and `beforeunload` are silenced.

## Testing in a real browser

The Chrome extension is unreliable here (hidden tab). Use Playwright from the repo's `node_modules` with the installed Chrome:

```js
import { chromium } from '/Users/amad/code/wayback-scraper/node_modules/playwright/index.mjs';
const b = await chromium.launch({ channel: 'chrome', headless: true });
```

- `scripts/shell-check.mjs` (next to this file) opens `?p=` pages and prints what the frame, the panes, the address bar and `?p=` show, plus page errors. Run it against `http://localhost:8080` and `https://palestineonline.net`. Production running the old code is the before/after baseline.
- Test against real pages. Inject a test link into an archived page only when no page has the case.
- `page.evaluate` runs **with user activation**, so it can't test "no click" paths. Schedule a `setTimeout` inside the page instead, and wait more than 5s.
- Playwright's `request` event also fires for requests CSP then blocks. Check `requestfailed` (`csp`) or count `response` events instead.
- To reproduce races: throttle with CDP `Network.emulateNetworkConditions` (latency 150ms, ~400KB/s).
- Some archived pages throw errors of their own (`Unexpected token '<'`, `animate.js`, Deir Yassin's `gotoURL` before the shims). Trace stacks before blaming the shell.
- After changing anything in the shell, re-run the earlier suites: framesets (Addameer `september2000`), scripted menus (Deir Yassin, omayya.com), Flash (Bethlehem 2000 header), `.asp`/`.php` pages, escape routes, wallpaper, Random, Webamp (`birzeit.edu/outloud/archive.html`).

## Shell UI conventions

- **98.css is the base for everything** (vendored in `public/vendor/98.css`). Stylesheets load in this order: 98.css → `public/styles/theme.css` → `layout.css` → `explorer.css`. The archive index loads 98.css → `theme.css`.
- `theme.css` is the single source for:
  - colours, under Windows' own names (`--ButtonFace`, `--ActiveTitle`, …), with green in place of navy;
  - edges: `--edge-raised`, `--edge-pressed`, `--edge-field`, `--edge-sunken-image`;
  - fonts: `--font-ui`, `--font-pixel`;
  - `.inset-deep` and `.inset-shallow`.
  Use these tokens; don't hard-code `#dfdfdf`, navy and the like.
- **98.css side effects the shell undoes:**
  - every `<button>` is a 75×23 dialog button with a shadow-text trick, so shell buttons reset `min-width`, `min-height` and `text-shadow`, including the `:active` state;
  - `.window` turns font smoothing off;
  - `<label>` and `<input>` get the 11px pixel font.
  IE's flat toolbar buttons (`button.lightweight`) are the shell's own.
- `.window-container` needs `contain: layout`: it is the containing block for the fixed-position panels.
- `iframe-scrollbars.css` holds 98.css's scrollbar rules, copied verbatim for archived pages. Re-copy them when 98.css is upgraded.
- Pixelated 16px icons (`image-rendering: pixelated`); sans-serif text.
- The status bar is hidden on phones (max-width 480px), and should stay hidden.
- Webamp is desktop-only and closes when the page changes.
- The wallpaper is chosen before first paint by an inline script, from the tile list the server writes into the page. Left half of the background goes back a tile, right half forward. Tiles are cached for a day.
- Touch screens only: no pinch-zoom on the chrome, and `maximum-scale=1`. The page in the frame can still be zoomed.
- `localStorage` is used only for per-viewer conveniences, always wrapped in try/catch.

## Gotchas

- macOS git has `core.ignorecase=true`, so case-only renames get lost. Use `git -c core.ignorecase=false rm --cached` and `add`.
- `sites/` (~25k files) **is** tracked in git; `storage/` is not.
- IPv6 has to work end to end: AAAA record `…150f::1`, nginx `listen [::]`, and ufw. Check with `curl -6`.
- Fonts with commercial licences (e.g. Dinamo's ABC Areal) must not go into this public repo. Check the licence before adding any.

// Build a browsable index of everything cdx-scraper.js has downloaded.
//
//   node src/build-index.js [--out FILE] [--all]
//
// Walks /sites for log.json files -- each one marks the root of a single crawl -- and
// emits one static HTML page: a tree of crawls and their pages on the left, an iframe
// on the right that loads whichever page you click.
//
// Page URLs are root-relative (`/sites/...`), the same form the scraper rewrites links
// into, so this file has to be served with the repo root as the web root:
//
//   npx http-server . -p 8080     then open http://localhost:8080/archive-index.html
//
// Opening it straight off disk with file:// will not work -- every link, both here and
// inside the archived pages themselves, resolves against the server root.

import fs from 'fs/promises';
import { existsSync } from 'fs';

import {
  DEST_PATH,
  destDir,
  displayUrl,
  findLogs,
  readCrawl,
  replayUrl,
} from './page-index.js';

function parseArgs(argv) {
  const outFlag = argv.indexOf('--out');
  return {
    // Sits at the repo root because page URLs are root-relative; putting it inside
    // /sites would not change that, only make the location more confusing.
    out: outFlag !== -1 ? argv[outFlag + 1] : 'archive-index.html',
    // Include pages whose file is missing from disk, rendered as unclickable. Off by
    // default: a log lists what the crawl *intended* to fetch, and the ones that 404ed
    // or were never reached are noise in a browsing tool.
    all: argv.includes('--all'),
  };
}

const opts = parseArgs(process.argv.slice(2));

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

// Longer than this and one row swamps the tree. The full text stays in the tooltip.
const TITLE_MAX = 120;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Root-relative and percent-encoded per segment, so spaces and other literal characters
// in archived filenames survive. The separators must not be encoded.
function pageHref(localPath) {
  return `/${DEST_PATH}/` + localPath.split('/').map(encodeURIComponent).join('/');
}

function renderCrawl(crawl) {
  const rows = crawl.pages
    .map((page) => {
      if (!page.exists) {
        return `<li class="missing" title="listed in log.json but not on disk">${escapeHtml(page.label)}</li>`;
      }

      const shortened =
        page.title.length > TITLE_MAX ? page.title.slice(0, TITLE_MAX) + '…' : page.title;

      // Full title in the tooltip alongside the archived URL, since the visible one is
      // truncated and many of these pages differ only past the cut.
      const tooltip = page.title
        ? `${page.title}\n${displayUrl(page.originalUrl)}`
        : displayUrl(page.originalUrl);

      const titleSpan = shortened
        ? ` <span class="t">${escapeHtml(shortened)}</span>`
        : '';

      // Carried on the row so the click handler can surface it above the frame without
      // needing a lookup table of every page in the archive.
      const wayback = replayUrl(page.timestamp, page.originalUrl);

      return (
        `<li><a href="${escapeHtml(pageHref(page.localPath))}"` +
        // The unencoded path is what ?p= carries, so the page can find this row from the
        // address bar without having to agree with the browser on how to decode an href.
        ` data-path="${escapeHtml(page.localPath)}"` +
        ` title="${escapeHtml(tooltip)}"` +
        (wayback ? ` data-wayback="${escapeHtml(wayback)}"` : '') +
        `>` +
        `<span class="f">${escapeHtml(page.label)}</span>${titleSpan}</a></li>`
      );
    })
    .join('\n');

  return (
    `<li><details data-root="${escapeHtml(crawl.root)}">\n<summary>${escapeHtml(crawl.root)} <span class="count">${crawl.pages.length}</span></summary>\n` +
    `<ul>\n${rows}\n</ul>\n</details></li>`
  );
}

function renderPage(crawls, stats) {
  const tree = crawls.map(renderCrawl).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Wayback archive index</title>
<!-- 98.css, vendored under public/vendor/98.css (MIT). The layout follows its own docs
     page: a fixed tree-view down the left, the content beside it. -->
<link rel="stylesheet" href="/vendor/98.css/98.css">
<style>
  body { margin: 0; background: silver; }

  /* 98.css for the chrome, but not its pixel font: the same elements it sets the font on,
     back to the default sans-serif and normal anti-aliasing. */
  body, .title-bar, .window, button, input, label, legend, option, select, table, textarea, ul.tree-view {
    font-family: sans-serif;
    -webkit-font-smoothing: auto;
  }

  /* The sidebar is fixed and the tree inside it scrolls on its own, so the search stays
     on screen however far down the list you are, and the frame never moves. */
  nav { position: fixed; top: 0; bottom: 0; left: 0; width: 340px; box-sizing: border-box; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  #search { width: 100%; box-sizing: border-box; }
  .nav-tools { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .nav-tools p { margin: 0; }
  .nav-tools span { display: flex; gap: 4px; }
  #tree { flex: 1; min-height: 0; overflow-y: auto; }
  .count { color: grey; }

  /* Filename stays the anchor of the row; the title is secondary and wraps under it. */
  #tree .f { word-break: break-all; }
  #tree .t { color: grey; }
  #tree .missing { color: grey; }
  /* The page in the frame, marked the way the tree view marks a focused row. */
  #tree a.active, #tree a.active .t { background: navy; color: #fff; }

  /* Top padding matches the sidebar's, so the window lines up with the search box. */
  main { margin-left: 356px; padding: 8px 16px 24px 0; }

  /* Capped at the frame's full width (800px, plus the well's 2px border and the window
     body's 8px margins) and otherwise as wide as the space beside the tree, so it narrows
     with the browser window. Never sized to its content, which would let a long title in
     the title bar stretch the window past the frame. */
  .viewer { max-width: 820px; }
  /* The page title, as plain text in the title bar; cut to the window's width, with the
     full text in its tooltip. */
  .title-bar-text { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .title-bar-text.untitled { font-weight: normal; font-style: italic; }

  /* The original address, in a sunken field like a browser's address bar. It links to
     the snapshot. A page whose log entry carried no timestamp -- or one the logs never
     listed -- keeps the address and loses the href, so it reads as plain text rather
     than a link that goes nowhere. */
  .address { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
  #wayback-link { flex: 1; min-width: 0; height: 21px; line-height: 15px; box-sizing: border-box; padding: 3px 4px; background: #fff; box-shadow: inset -1px -1px #fff, inset 1px 1px grey, inset -2px -2px #dfdfdf, inset 2px 2px #0a0a0a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #wayback-link:not([href]) { color: #222; cursor: default; }

  /* 800x600 at most: the archived pages are fixed-width 2001-era layouts, so a viewport
     that matches the era is the point. Narrower when the browser window is, with the
     height kept at 600 rather than scaled down -- a wide page scrolls sideways inside the
     frame either way, and a shorter frame would only show less of it.
     The frame sits in the same sunken border as the tree view. */
  .frame-well { padding: 2px; background: #fff; box-shadow: inset -1px -1px #fff, inset 1px 1px grey, inset -2px -2px #dfdfdf, inset 2px 2px #0a0a0a; }
  iframe { display: block; width: 100%; max-width: 800px; height: 600px; border: 0; background: #fff; }
  .status-bar-field { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* The page's tags, between the frame and the status bar. Each tag is a button that
     filters the tree to it; on the admin port each also gets a remove button, and the
     add field appears. 98.css sizes buttons for dialogs (75x23 minimum), too big here. */
  .tag-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 6px; margin-top: 6px; min-height: 23px; }
  .tag-bar button { min-width: 0; min-height: 0; padding: 2px 6px; }
  .tag { display: inline-flex; }
  .tag .tag-remove { padding: 2px 4px; }
  .tag-empty { color: grey; }
  #tag-form { display: flex; align-items: center; gap: 4px; margin-left: auto; }
  #tag-form[hidden] { display: none; }
  #tag-input { width: 160px; }
  #tag-error { color: #a00; }
  #frame-captured { flex: 0 0 150px; }
</style>
</head>
<body>
  <nav>
    <input id="search" type="search" placeholder="Filter by site, file, title, address or #tag  ( / )" aria-label="Filter pages" autocomplete="off" spellcheck="false">
    <div class="nav-tools">
      <p id="search-status" aria-live="polite">${stats.crawls} crawls, ${stats.linked} pages${stats.missing ? ` (${stats.missing} not on disk)` : ''}</p>
      <span>
        <button type="button" id="expand-all">Expand all</button>
        <button type="button" id="collapse-all">Collapse all</button>
      </span>
    </div>
    <ul class="tree-view" id="tree">
${tree}
    </ul>
  </nav>
  <main>
    <div class="window viewer">
      <div class="title-bar">
        <div class="title-bar-text untitled" id="frame-title">Select a page from the tree.</div>
      </div>
      <div class="window-body">
        <div class="address">
          <span>Address</span>
          <a id="wayback-link" target="_blank" rel="noopener"></a>
        </div>
        <div class="frame-well">
          <iframe id="frame" name="archive-frame" title="Archived page"></iframe>
        </div>
        <div class="tag-bar">
          <span>Tags</span>
          <span id="tag-list"></span>
          <span id="tag-error" role="alert"></span>
          <form id="tag-form" hidden>
            <input id="tag-input" type="text" placeholder="Add tags, comma-separated" aria-label="Add tags" maxlength="200" autocomplete="off" spellcheck="false">
            <button type="submit">Add</button>
          </form>
        </div>
      </div>
      <div class="status-bar">
        <p class="status-bar-field" id="frame-path">No page open</p>
        <p class="status-bar-field" id="frame-captured">&nbsp;</p>
      </div>
    </div>
  </main>
<script>
  var frame = document.getElementById('frame');
  var frameTitle = document.getElementById('frame-title');
  var waybackLink = document.getElementById('wayback-link');
  var framePathField = document.getElementById('frame-path');
  var capturedField = document.getElementById('frame-captured');
  var search = document.getElementById('search');
  var searchStatus = document.getElementById('search-status');
  var defaultStatus = searchStatus.textContent;
  var active = null;

  // --- the tree, read once ----------------------------------------------------

  // Each row's searchable text is built up front: the crawl it belongs to, the filename,
  // and the tooltip, which holds the full title and the archived address. Lowercased
  // here so a keystroke only has to do substring checks across ~11k rows.
  var crawls = [];
  var byPath = {};
  var rowByPath = {};

  Array.prototype.forEach.call(document.querySelectorAll('#tree details'), function (details) {
    var root = (details.getAttribute('data-root') || '').toLowerCase();
    var rows = [];

    Array.prototype.forEach.call(details.querySelectorAll('li'), function (li) {
      var link = li.querySelector('a');
      var text = root + ' ' + li.textContent + ' ' + (link ? link.getAttribute('title') || '' : '');
      var row = { li: li, text: text.toLowerCase(), tags: [], tagText: '' };
      rows.push(row);
      if (link) {
        byPath[link.getAttribute('data-path')] = link;
        rowByPath[link.getAttribute('data-path')] = row;
      }
    });

    crawls.push({
      details: details,
      item: details.parentElement,
      rows: rows,
      count: details.querySelector('.count'),
    });
  });

  // --- the address bar ----------------------------------------------------------

  // ?p= is the page in the frame and ?q= is the filter, the same p that index.html uses,
  // so a path can be carried between the two by changing nothing but the pathname.
  var currentPath = '';
  var currentQuery = '';

  function sitesUrl(path) {
    return '/sites/' + path.split('/').map(encodeURIComponent).join('/');
  }

  // Parsed by hand to match index.html and serve.js exactly: URLSearchParams would read
  // a '+' in a 2001-era filename as a space.
  function sharedPath() {
    var match = /[?&]p=([^&]*)/.exec(location.search);
    if (!match) return '';

    var path;
    try {
      path = decodeURIComponent(match[1]);
    } catch (err) {
      return ''; // malformed escape
    }

    // The value becomes a URL under /sites, so it must not climb out of it.
    if (!path || path.charAt(0) === '/' || path.split('/').indexOf('..') !== -1) return '';
    return path;
  }

  // replaceState, never pushState: navigating the frame already adds a history entry,
  // which is what makes Back work, so this relabels that entry rather than adding a
  // second one per page. The path is encoded per segment so its slashes stay readable.
  function syncUrl() {
    var others = new URLSearchParams(location.search);
    others.delete('p');
    others.delete('q');

    var parts = [];
    if (currentPath) parts.push('p=' + currentPath.split('/').map(encodeURIComponent).join('/'));
    if (currentQuery) parts.push('q=' + encodeURIComponent(currentQuery));
    var rest = others.toString();
    if (rest) parts.push(rest);

    var url = location.pathname + (parts.length ? '?' + parts.join('&') : '') + location.hash;
    if (url !== location.pathname + location.search + location.hash) {
      history.replaceState(history.state, '', url);
    }
  }

  // --- what the frame is showing -------------------------------------------------

  // Points the tree, the source line and the address bar at one page. Called for a click
  // in the tree, a shared link, and any navigation inside the frame -- a link in an
  // archived page, or Back and Forward -- so all three always describe the same thing.
  function describe(path, reveal) {
    currentPath = path;
    var link = byPath[path] || null;

    if (active !== link) {
      if (active) active.classList.remove('active');
      if (link) link.classList.add('active');
      active = link;
    }

    if (link) {
      // The row's tooltip is the full title and the original address on the line below
      // it, or the address alone for an untitled page. Read back from there rather than
      // carried as attributes of their own, which would add both to every one of ~11k rows.
      var tooltip = link.getAttribute('title') || '';
      var cut = tooltip.lastIndexOf('\\n');
      setLabel(cut === -1 ? '' : tooltip.slice(0, cut), tooltip.slice(cut + 1));

      // The address links to the snapshot. A row whose log entry carried no timestamp
      // keeps the address and drops the href, so the line stays put and simply stops
      // being clickable.
      var wayback = link.getAttribute('data-wayback');
      if (wayback) waybackLink.href = wayback;
      else waybackLink.removeAttribute('href');
      capturedField.textContent = captured(wayback);

      if (reveal) {
        link.closest('details').open = true;
        link.scrollIntoView({ block: 'nearest' });
      }
    } else {
      // Somewhere the crawl logs never listed -- an image, or a page reached by a link
      // the scraper rewrote but did not seed. The path is all there is to say about it.
      setLabel('', path);
      waybackLink.removeAttribute('href');
      capturedField.textContent = captured('');
    }

    framePathField.textContent = path;
    framePathField.title = path;

    renderTags();
    syncUrl();
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // The snapshot URL carries its capture time as /web/YYYYMMDDhhmmss/.
  function captured(wayback) {
    var match = /\\/web\\/(\\d{4})(\\d{2})(\\d{2})/.exec(wayback || '');
    if (!match) return 'No snapshot';
    return 'Captured ' + Number(match[3]) + ' ' + MONTHS[Number(match[2]) - 1] + ' ' + match[1];
  }

  function setLabel(title, address) {
    frameTitle.textContent = title || 'Untitled';
    frameTitle.title = title;
    frameTitle.classList.toggle('untitled', !title);
    waybackLink.textContent = address;
    waybackLink.title = address;
  }

  // Anchors keep real hrefs so middle-click and "open in new tab" still work; only a
  // plain left click is redirected into the frame.
  document.querySelector('nav').addEventListener('click', function (event) {
    var link = event.target.closest('a');
    if (!link) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;

    event.preventDefault();
    frame.src = link.getAttribute('href');
    // Described now rather than when the frame gets there, so the row and the source line
    // answer the click at once. The row is already on screen, so no scrolling.
    describe(link.getAttribute('data-path'), false);
  });

  // The frame's own location, as a path under /sites, or '' for anything else.
  function framePath() {
    var pathname;
    try {
      pathname = frame.contentWindow.location.pathname;
    } catch (err) {
      return ''; // navigated off-origin
    }
    if (pathname.indexOf('/sites/') !== 0) return '';
    try {
      return decodeURIComponent(pathname.slice('/sites/'.length));
    } catch (err) {
      return '';
    }
  }

  // Polled rather than waiting for load, for the same reason index.html polls: load waits
  // on every image from a host that died twenty years ago, and the location is known long
  // before. Compared against the frame's last location rather than currentPath, so a
  // tree click that has not reached the frame yet is not mistaken for a navigation back.
  var lastFramePath = '';
  setInterval(function () {
    var path = framePath();
    if (!path || path === lastFramePath) return;
    lastFramePath = path;
    if (path !== currentPath) describe(path, true);
  }, 100);

  // --- the filter -----------------------------------------------------------------

  // Which crawls were open before the filter took over, put back when it is cleared so
  // searching does not leave the whole tree expanded.
  var openBeforeFilter = null;

  // Splits a query into what each row must match: plain words, which must appear
  // somewhere in the row or its tags, and #tag (or #"two words") terms, which must be one
  // of its tags exactly. Quotes also keep a plain phrase together.
  function parseQuery(query) {
    var words = [];
    var tags = [];
    (query.toLowerCase().match(/#"[^"]*"|"[^"]*"|\\S+/g) || []).forEach(function (token) {
      if (token.indexOf('#"') === 0) tags.push(token.slice(2, -1).trim());
      else if (token.charAt(0) === '#' && token.length > 1) tags.push(token.slice(1));
      else if (token.charAt(0) === '"') words.push(token.slice(1, -1));
      else words.push(token);
    });
    return {
      words: words.filter(Boolean),
      tags: tags.filter(Boolean),
    };
  }

  function rowMatches(row, terms) {
    for (var i = 0; i < terms.tags.length; i++) {
      if (row.tags.indexOf(terms.tags[i]) === -1) return false;
    }
    for (var j = 0; j < terms.words.length; j++) {
      var word = terms.words[j];
      if (row.text.indexOf(word) === -1 && row.tagText.indexOf(word) === -1) return false;
    }
    return true;
  }

  // Every word must appear somewhere in the row, in any order, so "addameer jericho"
  // finds the Jericho pages of that one crawl.
  //
  // A new search opens every crawl with a match, which is what you want while typing.
  // keepOpen re-runs the same search without that -- for when a tag edit changes which
  // rows match, and expanding the tree you had collapsed would be the wrong answer to it.
  function applyFilter(query, keepOpen) {
    var terms = parseQuery(query);
    var filtering = terms.words.length > 0 || terms.tags.length > 0;

    if (filtering && !openBeforeFilter) {
      openBeforeFilter = crawls.map(function (c) { return c.details.open; });
    }

    var pages = 0;
    var sites = 0;

    crawls.forEach(function (crawl, i) {
      var matches = 0;
      crawl.rows.forEach(function (row) {
        var hit = rowMatches(row, terms);
        // Only touched when it changes: writing 11k attributes per keystroke is what
        // would make this lag, not the substring checks.
        if (row.li.hidden === hit) row.li.hidden = !hit;
        if (hit) matches += 1;
      });

      crawl.item.hidden = matches === 0;
      crawl.count.textContent = filtering ? matches + ' / ' + crawl.rows.length : crawl.rows.length;

      if (filtering) {
        if (!keepOpen) crawl.details.open = matches > 0;
      } else if (openBeforeFilter) crawl.details.open = openBeforeFilter[i];

      pages += matches;
      if (matches) sites += 1;
    });

    if (!filtering) {
      openBeforeFilter = null;
      // Whatever is on screen stays findable once the filter is gone.
      if (active) active.closest('details').open = true;
    }

    searchStatus.textContent = !filtering
      ? defaultStatus
      : pages
        ? pages + (pages === 1 ? ' page' : ' pages') + ' in ' + sites + (sites === 1 ? ' crawl' : ' crawls')
        : 'No matches';
  }

  // Filtered on a short delay so a fast typist pays for the last keystroke only.
  var filterTimer = 0;

  function runFilter() {
    clearTimeout(filterTimer);
    var query = search.value.trim();
    if (query === currentQuery) return;
    currentQuery = query;
    applyFilter(currentQuery);
    syncUrl();
  }

  search.addEventListener('input', function () {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(runFilter, 80);
  });

  search.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && search.value) {
      event.preventDefault();
      search.value = '';
      search.dispatchEvent(new Event('input'));
    } else if (event.key === 'Enter' && search.value.trim()) {
      // Opens the first match, so a precise enough search is a way to navigate. The
      // filter is brought up to date first, since Enter can land inside its delay.
      event.preventDefault();
      runFilter();
      var first = document.querySelector('#tree > li:not([hidden]) li:not([hidden]) a');
      if (first) first.click();
    }
  });

  // Applies to the crawls on screen, so while filtering it opens or closes only the
  // matches. It also replaces what the filter would restore on clearing, since "collapse
  // all" should still mean collapsed once the filter is gone.
  function setAllOpen(open) {
    crawls.forEach(function (crawl, i) {
      if (!crawl.item.hidden) crawl.details.open = open;
      if (openBeforeFilter) openBeforeFilter[i] = open;
    });
  }

  document.getElementById('expand-all').addEventListener('click', function () {
    setAllOpen(true);
  });
  document.getElementById('collapse-all').addEventListener('click', function () {
    setAllOpen(false);
  });

  // "/" to search, as on most sites with one, unless you are already typing somewhere.
  document.addEventListener('keydown', function (event) {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    event.preventDefault();
    search.focus();
    search.select();
  });

  // --- tags ----------------------------------------------------------------------

  // Tags come from the server rather than being baked into this file, so a tag added a
  // minute ago shows up without rebuilding the index. Everyone can read and filter by
  // them; only the admin port (see serve.js) can change them, and only there do the
  // remove buttons and the add field appear.
  var tagList = document.getElementById('tag-list');
  var tagForm = document.getElementById('tag-form');
  var tagInput = document.getElementById('tag-input');
  var tagError = document.getElementById('tag-error');
  var tagsByPath = {};
  var isAdmin = false;
  var saving = false;

  function setRowTags(path, tags) {
    if (tags.length) tagsByPath[path] = tags;
    else delete tagsByPath[path];

    var row = rowByPath[path];
    if (!row) return;
    row.tags = tags.map(function (t) { return t.toLowerCase(); });
    row.tagText = row.tags.join(' ');
  }

  // The search term for one tag: #tag, or #"two words" when it has a space in it.
  function tagTerm(tag) {
    return '#' + (/\\s/.test(tag) ? '"' + tag + '"' : tag);
  }

  function renderTags() {
    tagList.replaceChildren();
    tagError.textContent = '';

    // Tags belong to pages in the index; anything else the frame can reach (an image, a
    // page the logs never listed) has no row to hang them on.
    var indexed = !!rowByPath[currentPath];
    var tags = tagsByPath[currentPath] || [];

    tags.forEach(function (tag) {
      var chip = document.createElement('span');
      chip.className = 'tag';

      var name = document.createElement('button');
      name.type = 'button';
      name.textContent = tag;
      name.title = 'Show pages tagged ' + tag;
      name.addEventListener('click', function () {
        search.value = tagTerm(tag);
        runFilter();
      });
      chip.appendChild(name);

      if (isAdmin) {
        var remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'tag-remove';
        remove.textContent = '\u00d7';
        remove.title = 'Remove ' + tag;
        remove.setAttribute('aria-label', 'Remove tag ' + tag);
        remove.addEventListener('click', function () {
          saveTags(currentPath, tags.filter(function (t) { return t !== tag; }));
        });
        chip.appendChild(remove);
      }

      tagList.appendChild(chip);
    });

    if (!tags.length) {
      var empty = document.createElement('span');
      empty.className = 'tag-empty';
      empty.textContent = !currentPath ? '' : indexed ? 'None' : 'Not in the index';
      tagList.appendChild(empty);
    }

    tagForm.hidden = !(isAdmin && indexed);
  }

  // Sends the page's whole tag list; the server answers with what it stored, after its
  // own clean-up (commas, whitespace, case-insensitive duplicates), and that is what is
  // shown -- never the list as typed.
  function saveTags(path, tags) {
    if (saving) return;
    saving = true;
    tagError.textContent = '';

    fetch('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path, tags: tags }),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
          return body;
        });
      })
      .then(function (body) {
        setRowTags(body.local_path, body.tags);
        if (path === currentPath) {
          renderTags();
          tagInput.value = '';
        }
        // A page that gained or lost the tag being filtered on moves in or out of the tree,
        // without reopening crawls you collapsed.
        if (currentQuery) applyFilter(currentQuery, true);
      })
      .catch(function (err) {
        tagError.textContent = 'Could not save: ' + err.message;
      })
      .then(function () {
        saving = false;
      });
  }

  tagForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var added = tagInput.value.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
    if (!added.length || !currentPath) return;
    saveTags(currentPath, (tagsByPath[currentPath] || []).concat(added));
  });

  fetch('/api/tags')
    .then(function (res) { return res.ok ? res.json() : {}; })
    .then(function (all) {
      Object.keys(all).forEach(function (path) { setRowTags(path, all[path]); });
      renderTags();
      // A shared ?q= naming a tag could not match anything until the tags arrived.
      if (currentQuery) applyFilter(currentQuery);
    })
    .catch(function () {
      // No server behind this file (opened some other way): the tree works without tags.
    });

  fetch('/api/admin')
    .then(function (res) {
      isAdmin = res.ok;
      renderTags();
    })
    .catch(function () {});

  // --- opening a shared link -------------------------------------------------------

  currentQuery = (new URLSearchParams(location.search).get('q') || '').trim();
  if (currentQuery) {
    search.value = currentQuery;
    applyFilter(currentQuery);
  }

  // serve.js normally puts ?p= into the frame's src before the page is sent, so the right
  // page is already loading and this only has to describe it. Without that -- the file
  // served by something else -- the page is checked before it is opened, so a dead link
  // leaves an empty frame rather than a 404 inside it.
  (function openShared() {
    var path = sharedPath();
    if (!path) {
      syncUrl();
      return;
    }

    var url = sitesUrl(path);
    if (frame.getAttribute('src') === url) {
      describe(path, true);
      return;
    }

    fetch(url, { method: 'HEAD' })
      .then(function (res) { return res.ok; }, function () { return false; })
      .then(function (ok) {
        if (ok) {
          frame.src = url;
          describe(path, true);
        } else {
          currentPath = '';
          syncUrl();
        }
      });
  })();

  // Keep archived navigation inside the frame.
  //
  // These are frameset-era pages, and the scraper deliberately preserves their target
  // attributes -- \`_top\`, \`main\`, \`photo\` and friends are how a frameset drives its own
  // panes, so stripping them would break the sites when viewed standalone. Inside this
  // viewer, though, the top browsing context is the index page itself, so a link with
  // target="_top" (11968 of them in the current archive) replaces the whole tree, and a
  // link to a named pane that is not on screen -- because you clicked a sub-page rather
  // than its frameset -- resolves to no known context and the browser opens a new tab.
  //
  // So the containment belongs here rather than in the scraper: leave a target alone
  // when it names a frame that really exists inside this iframe, and otherwise load the
  // link in the iframe itself.
  function framesByName(win, name, depth) {
    if (depth > 5) return false;
    for (var i = 0; i < win.frames.length; i++) {
      try {
        if (win.frames[i].name === name) return true;
        if (framesByName(win.frames[i], name, depth + 1)) return true;
      } catch (err) {
        // A frame we cannot reach into cannot be the one being targeted.
      }
    }
    return false;
  }

  function onFrameClick(event) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;

    var link = event.target.closest && event.target.closest('a[target], area[target]');
    if (!link) return;

    var name = (link.getAttribute('target') || '').trim();
    var lower = name.toLowerCase();
    if (!name || lower === '_self') return;

    // A named pane that exists in here is genuine frameset navigation -- leave it.
    if (lower[0] !== '_' && framesByName(frame.contentWindow, name, 0)) return;

    var href = link.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#' || /^(mailto:|javascript:|tel:|data:)/i.test(href)) {
      return;
    }

    // Assign the location outright rather than rewriting the target attribute: this is
    // unambiguous, and for _top/_parent it gives the right result anyway -- replacing
    // the whole archived document, which is what those mean once the frameset is the
    // thing inside our iframe.
    event.preventDefault();
    try {
      frame.contentWindow.location.href = link.href;
    } catch (err) {
      frame.src = href;
    }
  }

  // Re-applied on every navigation, and to each nested frame of a frameset, since each
  // one is its own document with its own listener set.
  function harden(win) {
    var doc;
    try {
      doc = win.document;
    } catch (err) {
      return; // Not same-origin; nothing we can do and nothing we need to do.
    }
    if (!doc || doc.__hardened) return;
    doc.__hardened = true;
    doc.addEventListener('click', onFrameClick, true);

    for (var i = 0; i < win.frames.length; i++) {
      (function (sub) {
        try {
          harden(sub);
          sub.addEventListener('load', function () { harden(sub); });
        } catch (err) {
          // Unreachable frame; skip it.
        }
      })(win.frames[i]);
    }
  }

  frame.addEventListener('load', function () {
    harden(frame.contentWindow);
  });
</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function main() {
  if (!existsSync(destDir)) {
    console.error(`No ${DEST_PATH}/ directory here. Run this from the repo root.`);
    process.exit(1);
  }

  const logs = await findLogs(destDir);
  if (!logs.length) {
    console.error(`No log.json files found under ${DEST_PATH}/.`);
    process.exit(1);
  }

  const crawls = [];
  let linked = 0;
  let missing = 0;
  let titled = 0;

  for (const logPath of logs) {
    const crawl = await readCrawl(logPath, { all: opts.all });
    if (!crawl || !crawl.pages.length) continue;
    crawls.push(crawl);
    for (const page of crawl.pages) {
      if (page.exists) linked += 1;
      else missing += 1;
      if (page.title) titled += 1;
    }
  }

  const html = renderPage(crawls, { crawls: crawls.length, linked, missing });
  await fs.writeFile(opts.out, html, 'utf8');

  console.log(
    `Wrote ${opts.out}: ${crawls.length} crawls, ${linked} pages linked, ${titled} with titles.`
  );
  if (missing) {
    console.log(`${missing} logged pages are not on disk (shown greyed out).`);
  }
  console.log('\nServe from the repo root, e.g.  npx http-server . -p 8080');
  console.log(`then open  http://localhost:8080/${opts.out}`);
}

await main();

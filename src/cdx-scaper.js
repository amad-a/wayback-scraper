import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';
import * as cheerio from 'cheerio';

import pkg from 'fs-extra';
import { createWriteStream } from 'fs';
import fsExists from 'fs.promises.exists';
const { mkdir } = pkg;

const webPath = process.argv[2];
const fromBound = process.argv[3];
const toBound = process.argv[4] || process.argv[3];
const destDir = path.join(process.cwd(), 'cdx-output');
const overwrite = process.argv.includes('--overwrite');
const imagesOnly = process.argv.includes('--images');
let uniqueUrls = [];

if (!webPath) {
  console.error(
    'Please provide a website path to find in the Wayback Machine via the CDX api',
  );
  process.exit(1);
}

if (!fromBound) {
  console.error(
    'Please provide a Wayback Machine timestamp to search within (1 year or 2 datetime stamps',
  );
  process.exit(1);
}

const logPath = path.join(destDir, webPath, 'log.json');
const siteLogExists = await fsExists(logPath);

if (siteLogExists && !overwrite) {
  console.log('Page log found:', logPath);
  const data = await fs.readFile(logPath, 'utf-8');
  uniqueUrls = JSON.parse(data);
} else {
  if (overwrite && siteLogExists) {
    console.log('Overwriting existing page log...');
  } else {
    console.log('No page log file found, fetching from CDX API...');
  }

  // ensure no page snapshots with queries, to eliminate duplicate pages
  const noQueriesFilter = encodeURIComponent('!original:.*\\?.*');
  const noVtiFilter = encodeURIComponent('!original:.*_vti_.*');
  const noAspFilter = encodeURIComponent('!original:.*\\.asp.*');
  const imgFilter = '&filter=mimetype:image/.*';

  const cdxRequestUrl = `https://web.archive.org/cdx/search/cdx?url=${webPath}/*&output=json&from=${fromBound}&to=${
    toBound ? toBound : fromBound
  }&filter=statuscode:200&filter=${noQueriesFilter}&filter=${noVtiFilter}&filter=${noAspFilter}${imagesOnly ? imgFilter : ''}`;

  console.log('REQUEST URL:', cdxRequestUrl);

  const cdxResponse = await fetch(cdxRequestUrl);
  if (!cdxResponse.ok) {
    throw new Error(`HTTP error! Status: ${cdxResponse.status}`);
  }
  console.log('Page list successfully fetched from CDX API!');
  const cdxResponseJson = await cdxResponse.json();

  const pageObjects = cdxResponseJson.slice(1).map((arr) => ({
    urlKey: arr[0],
    timestamp: arr[1],
    originalUrl: arr[2],
    mimetype: arr[3],
    statusCode: arr[4],
    digest: arr[5],
    length: arr[6],
  }));

  // reverse so first (now last in reversed) snapshot of a url is preserved when mapping to uniqueUrls
  pageObjects.reverse();

  // media extension patterns to filter with
  const imageExtensions =
    /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|tiff?)$/i;
  const videoExtensions = /\.(mp4|avi|mov|wmv|flv|webm|mkv|m4v)$/i;
  const audioExtensions = /\.(mp3|wav|ogg|m4a|aac|flac|wma)$/i;
  const htmlExtensions = /\.(htm|html|shtml|asp|aspx|php|jsp)$/i;

  uniqueUrls = [
    ...new Map(
      pageObjects.map((page) => [page.urlKey, page]),
    ).values(),
  ];

  // Filter to keep only HTML and media files
  uniqueUrls = uniqueUrls.filter((page) => {
    const url = page.originalUrl.toLowerCase();

    // Keep if it contains htm
    if (htmlExtensions.test(url)) return true;
    // Keep if it's a media file
    if (imageExtensions.test(url)) return true;
    if (videoExtensions.test(url)) return true;
    if (audioExtensions.test(url)) return true;
    // Keep if it ends with / (directory/index)
    if (url.endsWith('/')) return true;

    // Filter out everything else (css, js, xml, txt, etc.)
    return false;
  });

  uniqueUrls.forEach(async (page) => {
    let suffix = page.mimetype.startsWith('text')
      ? 'if_'
      : page.mimetype.startsWith('im')
        ? 'im_'
        : '';
    let url = `https://web.archive.org/web/${page.timestamp}${suffix}/${page.originalUrl}`;
    page.url = url;
    // sanitize url to match local file paths
    page.originalUrl = page.originalUrl
      .replace(':80', '')
      .replace('www.', '')
      .replace('http:/', '')
      .toLowerCase();

    if (page.originalUrl.endsWith('/'))
      page.originalUrl += 'index.html';
  });

  await mkdir(path.join(destDir, webPath), { recursive: true });
  const file = createWriteStream(logPath);

  file.write(JSON.stringify(uniqueUrls));
  file.end();
  console.log(
    'Page log file successfully generated from CDX response.',
    uniqueUrls,
  );
}

async function replaceLinks(elemType, $, site) {
  const elemsDict = {
    a: 'href',
    area: 'href',
    body: 'background',
    img: 'src',
    frame: 'src',
    iframe: 'src',
  };

  const attrType = elemsDict[elemType];

  for (const element of $(elemType).get()) {
    // IMPORTANT! assumes (correctly, given inputed timestamp captures everything) all available urls on same domain are downloaded
    // TODO: check fsExists and domain, link directly to wayback machine for external browsing if not.
    // IDEA: TRACK/keep record of if on available page or wayback: attach script to every loaded page which tracks if (available) /sites/ OR web.archive.org/web clicked - to switch mode

    // make sure all final links are lowercase
    const attr = $(element).attr(attrType)?.toLowerCase();

    if (attr) {
      // ensure path replacement hasn't happened already
      if (
        !attr.startsWith('/') &&
        !attr.startsWith('https://') &&
        !attr.startsWith('mailto:')
      ) {
        let relativeHrefPath;
        // TODO check if localPath exists, create wayback machine url if does not exist AND url outside of current page domain
        if (attr.startsWith('http:/')) {
          // if attr is absolute url, remove http prefix
          relativeHrefPath = attr
            .replace('http:/', '')
            .replace('www.', '')
            .replace('www2.', '');
        } else {
          // if attr is not absolute url, append filename to path containing page
          relativeHrefPath = path.join(
            site.originalUrl.substring(
              0,
              site.originalUrl.lastIndexOf('/'),
            ),
            attr,
          );
        }
        $(element).attr(attrType, relativeHrefPath);
      }

      let attrLink = $(element).attr(attrType);
      attrLink = attrLink.endsWith('/')
        ? attrLink + 'index.html'
        : attrLink;

      if (attrLink.includes('#')) {
        console.log('poop1', attrLink);
        console.log('poop2', attrLink.split('#')[0]);
      }

      const exists = await fsExists(path.join(destDir, attrLink.split('#')[0]));

      if (attrType === 'href') {
        // TODO: edit this to handle all NOT html/htm/shtml links
        // TODO: make sure # anchors on same page are not disabled
        if (
          (!exists || attrLink.includes('.asp')) &&
          !attrLink.endsWith('/#')
        ) {
          // disable link if not found
          $(element).css('pointer-events', 'none');

          // remove invalid links from area, but store for later in data-href
          if (elemType === 'area') {
            $(element).removeAttr('href').attr('data-href', attrLink);
          }
        } else {
          // re-enable link if found
          const elemStyle = $(element).attr('style') || '';
          const elemStyleNoPointerEvents = elemStyle.replace(
            /pointer-events\s*:\s*[^;]+;?/gi,
            '',
          );
          $(element).attr('style', elemStyleNoPointerEvents);
        }
      }
    }
  }
  return $;
}

async function scrapeWaybackUrls(sites) {
  const browser = await puppeteer.launch({ headless: true });

  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 480 });

  // set headers to avoid bot detection
  await page.setExtraHTTPHeaders({
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Upgrade-Insecure-Requests': '1',
  });

  for (const [index, site] of sites.entries()) {
    let pageLinkRaw = site.originalUrl;
    let progressString = `(${index + 1}/${sites.length})`;
    const exists = await fsExists(path.join(destDir, pageLinkRaw));

    if (exists) {
      console.log(
        `${progressString} 📁 cdx-output${pageLinkRaw} already exists`,
      );
    } else {
      try {
        const response = await page.goto(site.url, {
          waitUntil: 'networkidle2',
          waitUntil: 'domcontentloaded',
          timeout: 5000,
        });

        let content;
        content = await page.content();

        if (site.mimetype.startsWith('text')) {
          content = content.replace('target="_blank"', '');
          // remove any charset definitions as rendered page is UTF-8
          content = content.replace(
            /<meta[^>]*http-equiv=["']Content-Type["'][^>]*\/?>/gi,
            '',
          );

          // remove wayback scripts and toolbar styles
          content = content.replace(
            /<head[^>]*>[\s\S]*?<\/head>/i,
            (head) => {
              return (
                head
                  // Scripts with web-static.archive.org src
                  .replace(
                    /<script[^>]*src="[^"]*web-static\.archive\.org[^"]*"[^>]*><\/script>/gi,
                    '',
                  )
                  // Stylesheets with web-static.archive.org href
                  .replace(
                    /<link[^>]*href="[^"]*web-static\.archive\.org[^"]*"[^>]*>/gi,
                    '',
                  )
                  // Inline scripts containing RufflePlayer
                  .replace(
                    /<script[^>]*>[\s\S]*?window\.RufflePlayer[\s\S]*?<\/script>/gi,
                    '',
                  )
                  // Inline scripts containing __wm.init
                  .replace(
                    /<script[^>]*>[\s\S]*?__wm\.init\([\s\S]*?<\/script>/gi,
                    '',
                  )
              );
            },
          );

          // remove pop up windows
          content = content.replace(
            /window\.open\((?:[^)(]+|\((?:[^)(]+|\([^)(]*\))*\))*\)/g,
            '',
          );

          // remove WB toolbar
          content = content.replace(
            /<!-- BEGIN WAYBACK TOOLBAR INSERT -->[\s\S]*?<!-- END WAYBACK TOOLBAR INSERT -->/gi,
            '',
          );

          content = content.replace(
            '</html>',
            `<!-- ${site.url} -->\n</html>`,
          );
        }

        if (site.mimetype.startsWith('im')) {
          let imagePage;
          imagePage = await page.evaluate(() => {
            const img = document.querySelector('img');
            return img ? img.src : null;
          });

          if (imagePage) content = await page.goto(imagePage);
        }

        // create file containing dir recursively
        await mkdir(
          path.join(
            destDir,
            pageLinkRaw.substring(0, pageLinkRaw.lastIndexOf('/')),
          ),
          { recursive: true },
        );

        // if implied index page add real index file
        if (pageLinkRaw.endsWith('/'))
          pageLinkRaw = pageLinkRaw + 'index.html';

        if (site.mimetype.startsWith('im') && content) {
          await fs.writeFile(
            path.join(destDir, pageLinkRaw.toLowerCase()),
            await content.buffer(),
          );
        } else {
          await fs.writeFile(
            path.join(destDir, pageLinkRaw.toLowerCase()),
            content,
            'utf8',
          );
        }

        // delay to combat bot detection
        await new Promise((r) => setTimeout(r, 1000));

        console.log(
          `${progressString} Saved ${site.url} to cdx-output${pageLinkRaw}`,
        );
      } catch (error) {
        console.error('‼️ error:', site.url, error);
      }
    }
  }

  for (const site of sites) {
    // check if file
    const filePath = path.join(destDir, site.originalUrl);
    const exists = await fsExists(filePath.toLowerCase());
    const isHtml =
      filePath.endsWith('html') || filePath.endsWith('htm');
    if (exists && isHtml) {
      const data = await fs.readFile(filePath, 'utf-8');
      let $ = cheerio.load(data);

      // remove wayback machine styles
      $('html').removeAttr('style');

      $ = await replaceLinks('a', $, site);
      $ = await replaceLinks('body', $, site);
      $ = await replaceLinks('img', $, site);
      $ = await replaceLinks('iframe', $, site);
      $ = await replaceLinks('frame', $, site);
      $ = await replaceLinks('area', $, site);

      // prevent page open in new tab
      $('[target="_blank"]').removeAttr('target');

      // disable email
      $('a[href^="mailto:"]').each((_, el) => {
        $(el).css('pointer-events', 'none');
      });

      // disable forms
      $('form').each((_, el) => {
        $(el)
          .removeAttr('action')
          .removeAttr('method')
          .attr('onsubmit', 'return false');
      });

      // remove whitespace from img only containing tables
      $('td, th').each((_, el) => {
        const $el = $(el);
        if (
          $el.children('img').length &&
          !$el.text().trim() &&
          $el.children().not('img').length === 0
        ) {
          $el.css('font-size', '0');
        }
      });

      const modifiedHtml = $.html();
      await fs.writeFile(filePath, modifiedHtml, 'utf8');
    }
    if (!exists) {
      console.log(`⚠️ file ${filePath} not found`);
    }
  }

  await browser.close();
}

await scrapeWaybackUrls(uniqueUrls);

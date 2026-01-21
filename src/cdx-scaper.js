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
const filterOut = process.argv[5];
let uniqueUrls = [];

if (!webPath) {
  console.error(
    'Please provide a website path to find in the Wayback Machine'
  );
  process.exit(1);
}

if (!fromBound) {
  console.error(
    'Please provide a Wayback Machine timestamp to search within (1 year or 2 datetime stamps'
  );
  process.exit(1);
}

const logPath = path.join(destDir, webPath, 'log.json');
const siteLogExists = await fsExists(logPath);

if (siteLogExists) {
  console.log('Page log found:', logPath);
  const data = await fs.readFile(logPath, 'utf-8');
  uniqueUrls = JSON.parse(data);
} else {
  console.log('No page log file found, fetching from CDX API...');

  // ensure no page snapshots with queries, to eliminate duplicate pages
  const noQueriesFilter = encodeURIComponent('!original:.*\\?.*');

  const cdxRequestUrl = `https://web.archive.org/cdx/search/cdx?url=${webPath}/*&output=json&from=${fromBound}&to=${
    toBound ? toBound : fromBound
  }&filter=statuscode:200&filter=${noQueriesFilter}`;

  const cdxResponse = await fetch(cdxRequestUrl);
  if (!cdxResponse.ok) {
    throw new Error(`HTTP error! Status: ${cdxResponse.status}`);
  }
  console.log('Page list successfully fetched from CDX API!');
  const cdxResponseJson = await cdxResponse.json();

  // CDX response structure:
  //   [
  //     "urlkey",
  //     "timestamp",
  //     "original",
  //     "mimetype",
  //     "statuscode",
  //     "digest",
  //     "length"
  //   ]

  const pageObjects = cdxResponseJson.slice(1).map((arr) => ({
    urlKey: arr[0],
    timestamp: arr[1],
    originalUrl: arr[2],
    mimetype: arr[3],
    statusCode: arr[4],
    digest: arr[5],
    length: arr[6],
  }));

  uniqueUrls = [
    ...new Map(
      pageObjects.map((page) => [page.urlKey, page])
    ).values(),
  ];

  uniqueUrls.forEach(async (page) => {
    let suffix = page.mimetype.startsWith('text')
      ? ''
      : page.mimetype.startsWith('image')
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
    uniqueUrls
  );
}

function replaceLinks(elemType, $, site) {
  const elemsDict = {
    a: 'href',
    body: 'background',
    img: 'src'
  }

  const attrType = elemsDict[elemType];
  
  $(elemType).each((_, element) => {
    const attr = $(element).attr(attrType);
    if (attr) {
      // ensure path replacement hasn't happened already
      if (!attr.startsWith('/')) {
        let relativeHrefPath;
        let hrefType;
        // TODO check if localPath exists, create wayback machine url if does not exist AND url outside of current page domain
        if (attr.startsWith('http:/')) {
          // if attr is absolute url, remove http prefix
          relativeHrefPath = attr.replace('http:/', '');
        } else {
          // if attr is not absolute url, append filename to path containing page
          relativeHrefPath = path.join(
            site.originalUrl.substring(
              0,
              site.originalUrl.lastIndexOf('/')
            ),
            attr
          );
        }

        // don't need this here?
        // const absoluteHrefPath = path.join(destDir, relativeHrefPath);

        $(element).attr(attrType, relativeHrefPath);
      }
    } else {
    }
  });

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
        `${progressString} cdx-output${pageLinkRaw} already exists`
      );
    } else {
      await page.goto(site.url, {
        waitUntil: 'networkidle2',
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      let content;
      content = await page.content();

      if (site.mimetype.startsWith('text')) {
        // remove any charset definitions as rendered page is UTF-8
        content = content.replace(
          /<meta[^>]*http-equiv=["']Content-Type["'][^>]*\/?>/gi,
          ''
        );

        // remove wayback scripts and toolbar styles
        content = content.replace(
          /<head[^>]*>[\s\S]*?<\/head>/i,
          (head) => {
            return head
              .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
              .replace(/<script\b[^>]*\/>/gi, '')
              .replace(
                /<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi,
                ''
              )
              .replace(
                /<link\b[^>]*type=["']text\/css["'][^>]*>/gi,
                ''
              )
              .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
          }
        );

        // remove WB toolbar
        content = content.replace(
          /<!-- BEGIN WAYBACK TOOLBAR INSERT -->[\s\S]*?<!-- END WAYBACK TOOLBAR INSERT -->/gi,
          ''
        );
      }

      if (site.mimetype.startsWith('image')) {
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
          pageLinkRaw.substring(0, pageLinkRaw.lastIndexOf('/'))
        ),
        { recursive: true }
      );

      // if implied index page add real index file
      if (pageLinkRaw.endsWith('/'))
        pageLinkRaw = pageLinkRaw + 'index.html';

      if (site.mimetype.startsWith('image')) {
        await fs.writeFile(
          path.join(destDir, pageLinkRaw),
          await content.buffer()
        );
      } else {
        await fs.writeFile(
          path.join(destDir, pageLinkRaw),
          content,
          'utf8'
        );
      }

      // delay to combat bot detection
      await new Promise((r) =>
        setTimeout(r, Math.random() * 2000 + 1000)
      );

      console.log(
        `${progressString} Saved ${site.url} to cdx-output${pageLinkRaw}`
      );
    }
  }

  for (const site of sites) {
    const filePath = path.join(destDir, site.originalUrl);
    const exists = await fsExists(filePath);
    const isHtml =
      filePath.endsWith('html') || filePath.endsWith('htm');
    if (exists && isHtml) {
      const data = await fs.readFile(filePath, 'utf-8');
      let $ = cheerio.load(data);

      $('html').removeAttr('style');
      $ = replaceLinks('a', $, site);
      $ = replaceLinks('body', $, site);
      $ = replaceLinks('img', $, site);

      const modifiedHtml = $.html();
      await fs.writeFile(filePath, modifiedHtml, 'utf8');
    } else {
        console.log(filePath, 'not found.');
    }
  }

  await browser.close();
}

await scrapeWaybackUrls(uniqueUrls);

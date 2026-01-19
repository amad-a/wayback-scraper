import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';

import pkg from 'fs-extra';
import { createReadStream, createWriteStream } from 'fs';
import fsExists from 'fs.promises.exists';
const { mkdir } = pkg;

const webPath = process.argv[2];
const fromBound = process.argv[3];
const toBound = process.argv[4] || process.argv[3];
const destDir = path.join(process.cwd(), 'cdx-output');
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

  const cdxRequestUrl = `https://web.archive.org/cdx/search/cdx?url=${webPath}/*&output=json&from=${fromBound}&to=${
    toBound ? toBound : fromBound
  }&filter=statuscode:200&`;

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
      pageObjects.map((page) => [page.originalUrl.toLowerCase(), page])
    ).values(),
  ];

  // console.dir(uniqueUrls, {'maxArrayLength': null});

  uniqueUrls.forEach(async (page) => {
    let suffix = page.mimetype.startsWith('text')
      ? ''
      : page.mimetype.startsWith('image')
      ? 'im_'
      : '';
    let url = `https://web.archive.org/web/${page.timestamp}${suffix}/${page.originalUrl}`;
    page.url = url;
    page.originalUrl = page.originalUrl.replace(':80', '');
    page.originalUrl = page.originalUrl.replace('www.', '');
    page.originalUrl = page.originalUrl.replace('http:/', '');
    page.originalUrl = page.originalUrl.toLowerCase();
    if (page.originalUrl.endsWith('/'))
      page.originalUrl += 'index.html';
  });

  await mkdir(path.join(destDir, webPath), { recursive: true });
  const file = createWriteStream(logPath);

  file.write(JSON.stringify(uniqueUrls));
  file.end();
  console.log('Page log file successfully generated from CDX response.');
}

// const imgSrcs = await page.$$eval('img', (imgs) =>
//   imgs.map((img) => img.src)
// );

// imgSrcs.forEach((imgSrc) => {
//   if (imageExtensions.test(imgSrc.toLowerCase())) {
//     crawledImages.push(imgSrc);
//   }
// });

async function scrapeWaybackUrls(sites) {
  const browser = await puppeteer.launch({ headless: true });

  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  for (const [index, site] of sites.entries()) {
    let pageLinkRaw = site.originalUrl;
    let progressString = `(${index}/${sites.length})`;
    const exists = await fsExists(path.join(destDir, pageLinkRaw));

    if (exists) {
      console.log(
        `${progressString} cdx-output${pageLinkRaw} already exists`
      );
    } else {
      await page.goto(site.url, {
        waitUntil: 'networkidle2',
      });

      let content;

      if (site.mimetype.startsWith('text'))
        content = await page.content();

      if (site.mimetype.startsWith('image')) {
        let imagePage;
        imagePage = await page.evaluate(() => {
          const img = document.querySelector('img');
          return img ? img.src : null;
        });

        if (imagePage) content = await page.goto(imagePage);
      }

      await mkdir(
        path.join(
          destDir,
          pageLinkRaw.substring(0, pageLinkRaw.lastIndexOf('/'))
        ),
        { recursive: true }
      );

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

      const randomDelay =
        Math.floor(Math.random() * (20 - 5 + 0.1)) + 5;
      await new Promise((resolve) =>
        setTimeout(resolve, randomDelay)
      );
      console.log(
        `${progressString} Saved ${site.url} to cdx-output${pageLinkRaw})`
      );
    }
  }
  await browser.close();
}

await scrapeWaybackUrls(uniqueUrls);

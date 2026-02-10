import { PlaywrightCrawler, Dataset, RequestQueue } from 'crawlee';
import { URL } from 'url';
import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import path from 'path';
import mime from 'mime-types';
import iconv from 'iconv-lite';
import { detect } from 'jschardet';
import fsExists from 'fs.promises.exists';
import puppeteer from 'puppeteer';
import readline from 'node:readline';
import { input } from '@inquirer/prompts';
import { once } from 'node:events';


// import { DOMParser } from 'xmldom';

const timestamp = new Date(Date.now());
const isoTimestamp = timestamp.toISOString();
const baseDir = path.join(process.cwd(), 'scraped-output');

const imageExtensions =
  /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|tiff?)$/i;

const waybackImageUrl = /\/web\/\d{14}im_/;
const waybackPageUrl = /\/web\/[0-9]+\/(https?:\/\/.[^/]+)(.*)/i;
const newUrl =
  /\/web\/([0-9]+)(id_|oe_|if_|mp_)?\/(https?:\/\/[^/]+)(.*)/i;

let crawledPages = [];
let crawledImages = [];
let domainDir = '';
let downloadImages = true;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function isImageFile(filename) {
  return /\.(jpe?g|png|gif|webp|svg|bmp|ico|tiff?)$/i.test(filename);
}

// Helper function to extract the original domain and URL from a Wayback URL
// TODO: make output here more predictable
function parseWaybackUrl(waybackUrl) {
  const match = waybackUrl.match(newUrl);

  return match
    ? {
      domain: new URL(match[3]).hostname,
      originalUrl: match[3] + (match[4] || ''),
    }
    : false;
}

// Helper function to ensure directory exists
async function ensureDir(dirPath) {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

// Helper function to determine file path and name from URL
function getLocalFilePath(baseDir, originalUrl, contentType) {
  // consolidate www and non www crawled pages
  originalUrl = originalUrl.replace('www.', '');
  originalUrl = originalUrl.replace('ww2.', '');

  const urlObj = new URL(originalUrl);
  let pathname = urlObj.pathname;
  console.log('🟣', pathname, `${waybackDir}/${urlObj.hostname}`);

  // Handle root path
  if (pathname === '/') {
    pathname = '/index.html';
  }
  // Handle paths without file extensions
  else if (!path.extname(pathname)) {
    const ext = mime.extension(contentType) || 'html';
    pathname = `${pathname.replace(/\/$/, '')}/index.${ext}`;
  }


  console.log(
    'wayback Dir',
    `${waybackDir.split('/')[0]}`,
    pathname
  );


  // Create full local path
  return path.join(
    baseDir,
    `${waybackDir.split('/')[0]}`,
    pathname
  );
}

// TODO better consolidate <head> script removal here
// Helper function to detect and convert encoding
async function handleHtmlEncoding(content) {
  let htmlContent = content;

  // const buffer = await response.arrayBuffer();
  // const text = iconv.decode(Buffer.from(buffer), guessedCharset);
  // Clean up the HTML content
  // TODO add wayback athena scripts to remove from html
  return (
    htmlContent
      // Update charset meta tag to UTF-8
      // .replace(
      //   /<meta[^>]*charset=['"]?([^'">\s]+)['"]?/gi,
      //   '<meta charset="utf-8"'
      // )
      // .replace(
      //   /<meta[^>]*content=['"]?[^'"]*charset=([^'">\s]+)[^'"]*/gi,
      //   '<meta http-equiv="Content-Type" content="text/html; charset=utf-8"'
      // )
      // Remove Wayback Machine toolbar
      .replace(
        /<!-- BEGIN WAYBACK TOOLBAR INSERT -->[\s\S]*?<!-- END WAYBACK TOOLBAR INSERT -->/g,
        ''
      )
      // Remove Wayback Machine scripts
      .replace(
        /<script>[\s\S]*?<!-- End Wayback Rewrite JS Include -->/g,
        ''
      )
      // Clean up any empty lines left by removals
      .replace(/^\s*[\r\n]/gm, '')
  );
}

async function crawlWaybackMachine(
  startUrl,
  dirBound,
  oneCrawl = false
) {
  // TODO remove oneCrawl option
  if (oneCrawl) console.log('processing only one url: ', startUrl);
  const parsedUrl = parseWaybackUrl(startUrl);
  if (!parsedUrl) {
    console.error('Could not parse Wayback URL');
    return;
  }

  const { domain, originalUrl } = parsedUrl;
  domainDir = domain;

  let maxRequests = 10;
  // maxRequests = 10;

  // Create base download directory
  // makes new dir if does not exist
  await ensureDir(baseDir);

  // Initialize the crawler
  const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: maxRequests,
    // Configure browser pool
    browserPoolOptions: {
      useFingerprints: true,
    },
    launchContext: {
      launchOptions: {
        headless: true,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
        ],
      },
    },

    maxConcurrency: 10,
    maxRequestRetries: 5,
    requestHandlerTimeoutSecs: 10,

    // Handler for each page
    async requestHandler({
      request,
      page,
      enqueueLinks,
      log,
      response,
    }) {
      log.info(`Processing ${request.url}`);

      // if (!['.gif','.jpg','.jpeg','.png','.bmp'].some(ext => path.extname(request.url).toLowerCase())) {
      try {
        // Get content type from response headers
        const contentType =
          response.headers()['content-type'] || 'text/html';

        const guessedCharset =
          response.headers()['x-archive-guessed-charset'] || 'utf-8';

        // Different handling based on content type
        let content;
        if (isImageFile(request.url)) {
          crawledImages.push(
            request.url.replace(/\/web\/(\d{14})\//, '/web/$1im_/')
          );
        } else if (contentType.includes('text/html')) {
          // Wait for page to load for HTML content
          await page.waitForLoadState('networkidle');

          // Set headers to avoid detection
          await page.setExtraHTTPHeaders({
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            Accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Upgrade-Insecure-Requests': '1',
          });

          const href = await page.evaluate(
            () => document.location.href
          );
          const title = await page.evaluate(() => document.title);
          if (title === 'Wayback Machine') {
            console.log(
              '⚠️ Wayback Machine Dead Link, not downloading'
            );
            return;
          }

          // TODO don't add images if width or height === 0
          // TODO enqueue frame/iframes too
          const imgSrcs = await page.$$eval('img', (imgs) =>
            imgs.map((img) => img.src)
          );

          imgSrcs.forEach((imgSrc) => {
            if (imageExtensions.test(imgSrc.toLowerCase())) {
              crawledImages.push(imgSrc);
            }
          });

          // get any background images embedded into body tag
          const imgBackgroundSrcs = await page.$$eval(
            'body',
            (bodys) => bodys.map((body) => body.background)
          );

          // if partial link, transform into full link
          imgBackgroundSrcs.forEach((imgSrc) => {
            if (imgSrc.startsWith('/web/')) {
              imgSrc = 'https://web.archive.org' + imgSrc;
              crawledImages.push(imgSrc);
            }
          });

          // Add random delay for HTML pages
          await new Promise((r) =>
            setTimeout(r, Math.random() * 200 + 100)
          );

          const htmlContent = await page.content();

          // Handle encoding detection and conversion
          content = await handleHtmlEncoding(
            htmlContent,
            contentType,
            log,
            guessedCharset
          );
        } else if (contentType.startsWith('image/')) {
          // For images, get the buffer directly
          content = await response.body();
        } else {
          // For other types (CSS, JS, etc.), get the raw buffer
          content = await response.body();
        }

        // Parse the original URL from the Wayback URL
        const parsedUrl = parseWaybackUrl(request.url);

        if (!parsedUrl) {
          log.error(`Could not parse URL: ${request.url}`);
          return;
        }

        // Get the local file path
        const localPath = getLocalFilePath(
          baseDir,
          parsedUrl.originalUrl,
          contentType
        );

        const fileExists = await fsExists(localPath);
        // Ensure the directory exists
        await ensureDir(path.dirname(localPath));

        // Save the content based on its type
        if (
          contentType.startsWith('image/') ||
          (!contentType.includes('text/html') &&
            Buffer.isBuffer(content))
        ) {
          await fs.writeFile(localPath, content);
        } else if (contentType.includes('text/html')) {
          if (!response.ok) {
            console.log(
              '❌ Not downloading file',
              response.status,
              response.statusText
            );
          } else if (fileExists) {
            console.log(localPath, 'already exists 📂');
          } else {
            console.log('📂 written to: ', localPath);
            // For HTML content, always save as UTF-8
            await fs.writeFile(localPath, content, 'utf8');
          }
        }

        log.info(`Saved to ${localPath}`);

        // Only parse links for HTML pages
        if (contentType.includes('text/html')) {
          // Extract and enqueue links from the same domain
          await enqueueLinks({
            globs: [`**/${dirBound}/**`, `**/www.${dirBound}/**`],
            selector: 'a[href]',
            transformRequestFunction: (req) => {
              // Ensure we're only crawling Wayback Machine URLs
              let waybackUrl = parseWaybackUrl(req.url);
              if (waybackUrl) {
                // remove anchor links resulting in redundant page results
                waybackUrl.originalUrl =
                  waybackUrl.originalUrl.split('#')[0];
                if (
                  // check if url is already crawled
                  crawledPages.includes(
                    waybackUrl.originalUrl.replace(/#.*$/, '')
                  ) ||
                  // check here if url is image
                  !req.url.includes(dirBound)
                ) {
                  return false;
                }
              }
              console.log('POOP', req.url);
              if (waybackUrl)
                crawledPages.push(waybackUrl.originalUrl);
              // TODO: write to file repeatedly instead of logging, gets too crowded in terminal
              console.log('🐞 PAGES: ', crawledPages);
              console.log('🎨 IMAGES: ', crawledImages);
              return req;
            },
          });
        }
      } catch (error) {
        log.error(
          `Error processing ${request.url}: ${error.message}`
        );
      }
    },

    // Failure handler
    failedRequestHandler: async ({ request, log }) => {
      log.error(`Failed to process ${request.url}`);
    },
  });

  // Start the crawler
  await crawler.run([startUrl]);
}

function generatePageListFile() {
  // don't add urls if one crawl
  if (oneCrawl) {
    console.log('no file generated for single page crawl');
    return;
  }

  console.log('generating page list file');

  let file = createWriteStream(
    `scraped-output/${waybackDir}/page-list.json`
  );
  file.on('error', function (err) {
    /* error handling */
  });
  crawledPages = crawledPages.sort();
  // TODO remove http:// prefix from crawledPages
  file.write(JSON.stringify(crawledPages));
  // crawledPages.forEach((element) => file.write(element + "\n"));
  file.end();
  console.log('page list file generated');
}

// trigger download here maybe, check if prompt
async function processCrawledImages() {
  let crawledImageUrlPairs = crawledImages.map((image) => {
    // get original url paths without web archive prefix
    let originalUrl = image.split('http://')[1];
    return { webArchiveFullUrl: image, originalUrl: originalUrl };
  });

  // Remove duplicate original paths
  let noDuplicateCrawledImagePairs = Array.from(
    new Map(
      crawledImageUrlPairs.map((img) => [img.originalUrl, img])
    ).values()
  );

  console.log('📸 crawled image pairs', noDuplicateCrawledImagePairs);
  
  const file = createWriteStream(
    path.join(baseDir, waybackDir, 'images.json')
  );

  await once(file, 'open');

  crawledPages = crawledPages.sort();

  file.write(JSON.stringify(noDuplicateCrawledImagePairs));
  file.end();
  console.log('images list file generated');

  // return noDuplicateCrawledImagePairs;
  if (downloadImages)
    downloadCrawledImages(noDuplicateCrawledImagePairs);
}

async function downloadCrawledImages(crawledImages) {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  for (const img of crawledImages) {
    try {
      // TODO: no timeout if image already exists
      await page.goto(img.webArchiveFullUrl, {
        waitUntil: 'networkidle2',
      });

      // Get the image source (assuming the image is in an <img> tag)
      const imageSrc = await page.evaluate(() => {
        const img = document.querySelector('img');
        return img ? img.src : null;
      });

      if (imageSrc) {
        const viewSource = await page.goto(imageSrc);
        const baseDir = path.join(process.cwd(), 'scraped-output');

        // consolidate www and non www crawled pages
        img.originalUrl = img.originalUrl.replace('www.', '');
        img.originalUrl = img.originalUrl.replace('ww2.', '');
        console.log('📛', img.originalUrl);
        if (
          await fsExists(
            `scraped-output/${img.originalUrl}`
          )
        ) {
          console.log(
            '📂 already exists: ',
            `scraped-output/${img.originalUrl}`
          );
        } else {
          await fs.mkdir(
            path.dirname(
              `scraped-output/${img.originalUrl}`
            ),
            { recursive: true }
          );
          await fs.writeFile(
            path.join(baseDir, `${img.originalUrl}`),
            await viewSource.buffer(),
            { recursive: true }
          );
          console.log(
            `Downloaded: ${img.webArchiveFullUrl} to scraped-output/${img.originalUrl}`
          );
        }
      } else {
        console.error(`No image found at ${img.webArchiveFullUrl}`);
      }
      // Random delay to avoid rate limiting
      const randomDelay =
        Math.floor(Math.random() * (200 - 50 + 1)) + 50;
      await new Promise((resolve) =>
        setTimeout(resolve, randomDelay)
      );
    } catch (error) {
      console.error(
        `Failed to download ${img.webArchiveFullUrl} to ${img.originalUrl}:`,
        error.message
      );
    }
  }

  await browser.close();
  console.log('All images 🐞🐞processed.');
  process.exit(1);
  return;
}

async function downloadImagesPrompt() {
  const selection = await input({
    message: 'Download Images Right Now? (Y/n)',
  });
  if (!(selection.toLowerCase() === 'y') && selection !== '') {
    downloadImages = false;
  }
}

const waybackUrl = process.argv[2];
const waybackDir = process.argv[3];

if (process.argv[4] === '-i') {
  // await here works, try to read and parse the images.json and then just pass it like
  // downloadCrawledImages(noDuplicateCrawledImagePairs);
  try {
    // images.json
    await fs.access(path.join(baseDir, waybackDir));

    const data = await fs.readFile(path.join(baseDir, waybackDir, 'images.json'), 'utf-8');
    const parsedData = JSON.parse(data);
    await downloadCrawledImages(parsedData);
  } catch {
    console.error(`‼️ Wayback Machine containing path not found in ${baseDir}`);
  }

  console.log('');

  process.exit(1);
} else {
  if (!waybackUrl) {
    console.error(
      'Please provide an Entrypoint Wayback Machine URL to begin crawl'
    );
    process.exit(1);
  }

  if (!waybackDir) {
    console.error(
      'Please provide a Wayback Machine containing path to scan for sites as an argument'
    );
    process.exit(1);
  }

  crawlWaybackMachine(waybackUrl, waybackDir)
    .then(() =>
      console.log('Crawling completed! crawled urls:', crawledPages)
    )
    .then(() => downloadImagesPrompt())
    // .then(() => generatePageListFile())
    .then(() => console.log('crawled images:', crawledImages))
    .then(() => processCrawledImages(crawledImages))
    .then(() => process.exit(1))
    .catch((error) => console.error('Crawling failed:', error));

}

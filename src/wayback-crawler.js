import { PlaywrightCrawler, Dataset } from 'crawlee';
import { URL } from 'url';
import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import path from 'path';
import mime from 'mime-types';
import iconv from 'iconv-lite';
import { detect } from 'jschardet';
import fsExists from 'fs.promises.exists';
import puppeteer from 'puppeteer';
// import { DOMParser } from 'xmldom';

const timestamp = new Date(Date.now());
const isoTimestamp = timestamp.toISOString();
const baseDir = path.join(process.cwd(), 'scraped-output');

const imageExtensions =
  /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|tiff?)$/i;

const testImageUrls = [
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020821165006im_/http://www.jericho-city.org/images/OPENING-.JPG',
    originalUrl: 'www.jericho-city.org/images/OPENING-.JPG',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020821165006im_/http://fastcounter.linkexchange.com/fastcounter?770332+1540671',
    originalUrl:
      'fastcounter.linkexchange.com/fastcounter?770332+1540671',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020803062633im_/http://jericho-city.org/images/sub_screen2.jpg',
    originalUrl: 'jericho-city.org/images/sub_screen2.jpg',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020206055344im_/http://jericho-city.org/images/Crstlbal.gif',
    originalUrl: 'jericho-city.org/images/Crstlbal.gif',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20021208220758im_/http://jericho-city.org/images/colorbar.gif',
    originalUrl: 'jericho-city.org/images/colorbar.gif',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20000106035157im_/http://www.jericho-city.org/images/sub_screen2.jpg',
    originalUrl: 'www.jericho-city.org/images/sub_screen2.jpg',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020609205836im_/http://www.jericho-city.org/images/EMAIL.GIF',
    originalUrl: 'www.jericho-city.org/images/EMAIL.GIF',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20021208220758im_/http://jericho-city.org/images/CHICKDAN.GIF',
    originalUrl: 'jericho-city.org/images/CHICKDAN.GIF',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020609233050im_/http://www.jericho-city.org/images/LOG.GIF',
    originalUrl: 'www.jericho-city.org/images/LOG.GIF',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020609233050im_/http://www.jericho-city.org/images/COOL.GIF',
    originalUrl: 'www.jericho-city.org/images/COOL.GIF',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20001013084620im_/http://www.jericho-city.org/images/pic1-1.JPG',
    originalUrl: 'www.jericho-city.org/images/pic1-1.JPG',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20001013084620im_/http://www.jericho-city.org/images/pic2-2.JPG',
    originalUrl: 'www.jericho-city.org/images/pic2-2.JPG',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20001013084620im_/http://www.jericho-city.org/images/pic7-7.JPG',
    originalUrl: 'www.jericho-city.org/images/pic7-7.JPG',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20001013084620im_/http://www.jericho-city.org/images/pic5-5.JPG',
    originalUrl: 'www.jericho-city.org/images/pic5-5.JPG',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20001013084620im_/http://www.jericho-city.org/images/pic11-11.JPG',
    originalUrl: 'www.jericho-city.org/images/pic11-11.JPG',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20001013084620im_/http://www.jericho-city.org/images/pic9-9.JPG',
    originalUrl: 'www.jericho-city.org/images/pic9-9.JPG',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20001013084620im_/http://www.jericho-city.org/images/pic10-10.JPG',
    originalUrl: 'www.jericho-city.org/images/pic10-10.JPG',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20001013084620im_/http://www.jericho-city.org/images/pic8-8.JPG',
    originalUrl: 'www.jericho-city.org/images/pic8-8.JPG',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20001013084620im_/http://www.jericho-city.org/images/pic12-12.JPG',
    originalUrl: 'www.jericho-city.org/images/pic12-12.JPG',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20001013084620im_/http://www.jericho-city.org/images/pic3-3.JPG',
    originalUrl: 'www.jericho-city.org/images/pic3-3.JPG',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20001013084620im_/http://www.jericho-city.org/images/pic4-4.JPG',
    originalUrl: 'www.jericho-city.org/images/pic4-4.JPG',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20001013084620im_/http://www.jericho-city.org/images/pic6-6.JPG',
    originalUrl: 'www.jericho-city.org/images/pic6-6.JPG',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020822215109im_/http://jericho-city.org/Corel/Crstlbal.gif',
    originalUrl: 'jericho-city.org/Corel/Crstlbal.gif',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20001013113215im_/http://www.jericho-city.org/Corel/Crstlbal.gif',
    originalUrl: 'www.jericho-city.org/Corel/Crstlbal.gif',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020822220705im_/http://jericho-city.org/images/opening-image.jpg',
    originalUrl: 'jericho-city.org/images/opening-image.jpg',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20021106214012im_/http://jericho-city.org/images/ag_back.gif',
    originalUrl: 'jericho-city.org/images/ag_back.gif',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020629061239im_/http://www.jericho-city.org/images/Crstlbal.gif',
    originalUrl: 'www.jericho-city.org/images/Crstlbal.gif',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020629061239im_/http://www.jericho-city.org/images/colorbar.gif',
    originalUrl: 'www.jericho-city.org/images/colorbar.gif',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020625222123im_/http://www.jericho-city.org/images/pic2.jpg',
    originalUrl: 'www.jericho-city.org/images/pic2.jpg',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020625222123im_/http://www.jericho-city.org/images/previous.gif',
    originalUrl: 'www.jericho-city.org/images/previous.gif',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020625222123im_/http://www.jericho-city.org/images/pic1.h1.gif',
    originalUrl: 'www.jericho-city.org/images/pic1.h1.gif',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020625222123im_/http://www.jericho-city.org/images/next.gif',
    originalUrl: 'www.jericho-city.org/images/next.gif',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020624202956im_/http://www.jericho-city.org/images/pic1.jpg',
    originalUrl: 'www.jericho-city.org/images/pic1.jpg',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020629045326im_/http://www.jericho-city.org/images/pic7.JPG',
    originalUrl: 'www.jericho-city.org/images/pic7.JPG',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020629045843im_/http://www.jericho-city.org/images/pic9.JPG',
    originalUrl: 'www.jericho-city.org/images/pic9.JPG',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020625221130im_/http://www.jericho-city.org/images/pic11.JPG',
    originalUrl: 'www.jericho-city.org/images/pic11.JPG',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020627030516im_/http://www.jericho-city.org/images/pic5.jpg',
    originalUrl: 'www.jericho-city.org/images/pic5.jpg',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020629045334im_/http://www.jericho-city.org/images/pic8.JPG',
    originalUrl: 'www.jericho-city.org/images/pic8.JPG',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020625221358im_/http://www.jericho-city.org/images/pic10.JPG',
    originalUrl: 'www.jericho-city.org/images/pic10.JPG',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020627032756im_/http://www.jericho-city.org/images/pic3.jpg',
    originalUrl: 'www.jericho-city.org/images/pic3.jpg',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020825034907im_/http://jericho-city.org/images/pic12.JPG',
    originalUrl: 'jericho-city.org/images/pic12.JPG',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020825034444im_/http://jericho-city.org/images/previous.gif',
    originalUrl: 'jericho-city.org/images/previous.gif',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020825034444im_/http://jericho-city.org/images/pic1.h1.gif',
    originalUrl: 'jericho-city.org/images/pic1.h1.gif',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020825034444im_/http://jericho-city.org/images/next.gif',
    originalUrl: 'jericho-city.org/images/next.gif',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020627032907im_/http://www.jericho-city.org/images/pic4.jpg',
    originalUrl: 'www.jericho-city.org/images/pic4.jpg',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020627031405im_/http://www.jericho-city.org/images/pic6.JPG',
    originalUrl: 'www.jericho-city.org/images/pic6.JPG',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20001013141352im_/http://www.jericho-city.org/images/opening-image.jpg',
    originalUrl: 'www.jericho-city.org/images/opening-image.jpg',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20030315052608im_/http://www.jericho-city.org/CHICKDAN.GIF',
    originalUrl: 'www.jericho-city.org/CHICKDAN.GIF',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020822220701im_/http://jericho-city.org/images/pic11.JPG',
    originalUrl: 'jericho-city.org/images/pic11.JPG',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020822221522im_/http://jericho-city.org/images/pic1.jpg',
    originalUrl: 'jericho-city.org/images/pic1.jpg',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020822221744im_/http://jericho-city.org/images/pic10.JPG',
    originalUrl: 'jericho-city.org/images/pic10.JPG',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020826021620im_/http://jericho-city.org/images/pic9.JPG',
    originalUrl: 'jericho-city.org/images/pic9.JPG',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020826020543im_/http://jericho-city.org/images/pic8.JPG',
    originalUrl: 'jericho-city.org/images/pic8.JPG',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020826015136im_/http://jericho-city.org/images/pic7.JPG',
    originalUrl: 'jericho-city.org/images/pic7.JPG',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020826015205im_/http://jericho-city.org/images/pic6.JPG',
    originalUrl: 'jericho-city.org/images/pic6.JPG',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020825035436im_/http://jericho-city.org/images/pic5.jpg',
    originalUrl: 'jericho-city.org/images/pic5.jpg',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020825034150im_/http://jericho-city.org/images/pic4.jpg',
    originalUrl: 'jericho-city.org/images/pic4.jpg',
  },
  {
    webArchiveFullUrl:
      'https://web.archive.org/web/20020825034444im_/http://jericho-city.org/images/pic3.jpg',
    originalUrl: 'jericho-city.org/images/pic3.jpg',
  },
];

const waybackImageUrl = /\/web\/\d{14}im_/;
const waybackPageUrl = /\/web\/[0-9]+\/(https?:\/\/.[^/]+)(.*)/i;

let crawledPages = [];
let crawledImages = [];
let domainDir = '';

function isImageFile(filename) {
  return /\.(jpe?g|png|gif|webp|svg|bmp|ico|tiff?)$/i.test(filename);
}

// Helper function to extract the original domain and URL from a Wayback URL
function parseWaybackUrl(waybackUrl) {
  const match = waybackUrl.match(waybackPageUrl);
  return match
    ? {
        domain: new URL(match[1]).hostname,
        originalUrl: match[1] + (match[2] || ''),
      }
    : false;
}

// TODO: bound always needs to be true
// 'url' arg is url from the queue
function urlInBounds(url, bound) {
  const parsedUrl = parseWaybackUrl(url);
  const parsedBound = parseWaybackUrl(bound);
  return parsedUrl?.originalUrl.includes(parsedBound.originalUrl);
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

  originalUrl = originalUrl.replace('www.', '');
  originalUrl = originalUrl.replace('ww2.', '');
  
  const urlObj = new URL(originalUrl);
  let pathname = urlObj.pathname;

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
    `${waybackDir}/${urlObj.hostname}`,
    pathname
  );

  // Create full local path
  return path.join(
    baseDir,
    `${waybackDir}/${urlObj.hostname}`,
    pathname
  );
}

// Helper function to detect and convert encoding
async function handleHtmlEncoding(content, contentType, log) {
  // If content is already a string, we need to convert it to a buffer first
  const contentBuffer = Buffer.isBuffer(content)
    ? content
    : Buffer.from(content);

  // Try to detect encoding from content-type header
  let encoding = 'utf-8';
  const charsetMatch = contentType.match(/charset=([^;]+)/i);
  if (charsetMatch) {
    encoding = charsetMatch[1].toLowerCase();
  } else {
    // If no charset in header, detect from content
    const detected = detect(contentBuffer);
    if (detected && detected.encoding) {
      encoding = detected.encoding.toLowerCase();
    }
  }

  log.info(`Detected encoding: ${encoding}`);

  let htmlContent;
  // Convert content to UTF-8 if needed
  try {
    if (
      encoding === 'utf-8' ||
      encoding === 'ascii' ||
      encoding === 'utf8'
    ) {
      htmlContent = contentBuffer.toString('utf8');
    } else if (iconv.encodingExists(encoding)) {
      htmlContent = contentBuffer.toString('utf8');
    } else {
      log.warning(
        `Unsupported encoding: ${encoding}, falling back to UTF-8`
      );
      htmlContent = contentBuffer.toString('utf8');
    }
  } catch (error) {
    log.error(
      `Error converting encoding: ${error.message}, falling back to UTF-8`
    );
    htmlContent = contentBuffer.toString('utf8');
  }

  // Clean up the HTML content
  // TODO add wayback athena scripts to remove from html
  return (
    htmlContent
      // Update charset meta tag to UTF-8
      .replace(
        /<meta[^>]*charset=['"]?([^'">\s]+)['"]?/gi,
        '<meta charset="utf-8"'
      )
      .replace(
        /<meta[^>]*content=['"]?[^'"]*charset=([^'">\s]+)[^'"]*/gi,
        '<meta http-equiv="Content-Type" content="text/html; charset=utf-8"'
      )
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
  if (oneCrawl) console.log('processing only one url: ', startUrl);
  const parsedUrl = parseWaybackUrl(startUrl);
  if (!parsedUrl) {
    console.error('Could not parse Wayback URL');
    return;
  }

  // ok keep separate urls (eg www/ no www), bc not sure if links will be different as well.
  // BUT consolidate list(s) if need be.
  // in config, encapsulate both domains
  // OR if both domains are on one list just use that

  const { domain, originalUrl } = parsedUrl;
  domainDir = domain;

  const maxRequests = oneCrawl ? 1 : 1000000000;

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

    maxConcurrency: 20,
    maxRequestRetries: 3,
    requestHandlerTimeoutSecs: 60,

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

        // Different handling based on content type
        let content;
        // const lowercaseUrl = request.url.toLowerCase();
        if (isImageFile(request.url)) {
          crawledImages.push(request.url.replace(/\/web\/(\d{14})\//,  '/web/$1im_/'));
        }
        else if (contentType.includes('text/html')) {
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

          const imgElements = await page.evaluate(() =>
            document.querySelectorAll('img')
          );
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

          // Get raw content first
          const rawContent = await response.body();

          // Handle encoding detection and conversion
          content = await handleHtmlEncoding(
            rawContent,
            contentType,
            log
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
          // For HTML content, always save as UTF-8
          if (!fileExists) {
            await fs.writeFile(localPath, content, 'utf8');
          } else {
            console.log(localPath, 'already exists 📂');
          }
        }

        log.info(`Saved to ${localPath}`);

        // Only parse links for HTML pages
        if (contentType.includes('text/html')) {
          // Extract and enqueue links from the same domain
          await enqueueLinks({
            globs: [`**/${dirBound}/**`, `**/www.${dirBound}/**`],
            selector: 'a[href], area[href]',
            transformRequestFunction: (req) => {
              // Ensure we're only crawling Wayback Machine URLs
              let waybackUrl = parseWaybackUrl(req.url);
              // remove anchor links resulting in redundant page results
              // TODO: split erroring in some cases catch why (though not breaking)
              waybackUrl.originalUrl =
                waybackUrl.originalUrl.split('#')[0];
              if (waybackUrl) {
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
              console.log('wayback url', waybackUrl);
              if (waybackUrl)
                crawledPages.push(waybackUrl.originalUrl);
              console.log('🐞', crawledPages);
              console.log('🔎', crawledImages);
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
    `scraped-output/${domainDir}/page-list.json`
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

async function processCrawledImages(crawledImages) {
  let crawledImageUrlPairs = crawledImages.map((image) => {
    // get original url paths without web archive prefix
    let originalUrl = image.split('http://')[1];
    return { webArchiveFullUrl: image, originalUrl: originalUrl };
  });

  // let noDuplicateCrawledImagePairs = crawledImageUrlPairs()
  let noDuplicateCrawledImagePairs = Array.from(
    new Map(
      crawledImageUrlPairs.map((img) => [img.originalUrl, img])
    ).values()
  );

  console.log('📸 crawled image pairs', noDuplicateCrawledImagePairs);
  return noDuplicateCrawledImagePairs;
}

async function downloadCrawledImages(crawledImages) {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  for (const img of crawledImages) {
    // const lastSlashIndex = img?.originalUrl?.lastIndexOf('/');
    // const dirPath = img.originalUrl.slice(0, lastSlashIndex);
    // const filePath = img.originalUrl.slice(lastSlashIndex + 1);

    try {
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
        img.originalUrl = img.originalUrl.replace('www.', '');
        img.originalUrl = img.originalUrl.replace('ww2.', '');
        fs.mkdir(
          path.dirname(
            `scraped-output/${waybackDir}/${img.originalUrl}`
          ),
          { recursive: true }
        );
        fs.writeFile(
          path.join(
            baseDir,
            `${waybackDir}`,
            `${img.originalUrl}`
          ),
          await viewSource.buffer(),
          { recursive: true }
        );
        console.log(
          `Downloaded: ${img.webArchiveFullUrl} to scraped-output/${waybackDir}/${img.originalUrl}`
        );
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
  console.log('All images processed.');
  return;
}

async function processWaybackPageLinks() {
  let pageList = await fs.readFile(
    `scraped-output/${waybackDir}/page-list.json`
  );
  let parsedPages = JSON.parse(pageList);

  const hrefPattern = /href=["']([^"']+)["']/gi;
  const srcPattern = /src=["']([^"']+)["']/gi;

  // TODO keep original wayback links as well

  for (let file of parsedPages) {
    let noHttpPrefixFile = file.split('http://')[1];
    let fileExists = await fsExists(
      `scraped-output/${noHttpPrefixFile}`
    );
    // console.log(`file ${noHttpPrefixFile} exists: ${fileExists}`);
    if (
      fileExists &&
      (noHttpPrefixFile.endsWith('html') ||
        noHttpPrefixFile.endsWith('htm'))
    ) {
      let htmlPageBuffer = await fs.readFile(
        `scraped-output/${noHttpPrefixFile}`
      );
      let htmlString = htmlPageBuffer.toString();

      const hrefMatchData = [...htmlString.matchAll(hrefPattern)];
      const hrefMatches = hrefMatchData.map((match) => match[1]);

      // console.log('HREF MATCHES', hrefMatches);
      const hrefMatchesSanitized = hrefMatches.map((match) => {
        let sanitizedMatch = match.match(waybackPageUrl);
        if (sanitizedMatch === null) return null;
        return '/sites/' + match.split('http://')[1];
      });
      // console.log('HREF PATTERN MATCHES', hrefMatchesSanitized);

      const srcMatches = [...htmlString.matchAll(srcPattern)];

      let srcMatchesFiltered = srcMatches
        .map((match) => match[1])
        .filter((src) => imageExtensions.test(src));

      const srcMatchesSanitized = srcMatchesFiltered.map((match) => {
        let sanitizedMatch = match.match(waybackImageUrl);
        if (sanitizedMatch === null) return null;
        return '/sites/' + match.split('http://')[1];
      });

      console.log('SRC MATCHES', srcMatchesFiltered);
      console.log('SRC PATTERN MATCHES', srcMatchesSanitized);
    }
  }

  return;
}

// Example usage
const waybackUrl = process.argv[2];
const waybackDir = process.argv[3];
const oneCrawl = process.argv[4];
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

// await processWaybackPageLinks();

// TODO: start at/ stop at args in the program chain

crawlWaybackMachine(waybackUrl, waybackDir, oneCrawl)
  .then(() =>
    console.log('Crawling completed! crawled urls:', crawledPages)
  )
  .then(() => generatePageListFile())
  .then(() => console.log('crawled images:', crawledImages))
  .then(() => processCrawledImages(crawledImages))
  .then((noDuplicateCrawledImagePairs) =>
    downloadCrawledImages(noDuplicateCrawledImagePairs)
  )
  // .then(() => processWaybackPageLinks())
  //TODO: Auto process link changes and images here
  .catch((error) => console.error('Crawling failed:', error));

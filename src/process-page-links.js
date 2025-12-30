import { URL } from 'url';
import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import path from 'path';
import mime from 'mime-types';
import fsExists from 'fs.promises.exists';
// import fs from 'node:fs/promises';
import recursiveReadDir from 'recursive-readdir';
import recursiveReaddirFiles from 'recursive-readdir-files';

// const hrefPattern = /href=(["'])([^"']+)\1/gi;
const hrefPattern = /href=["']([^"']+)["']/gi;

const srcPattern = /src=["']([^"']+)["']/gi;
const webArchiveDomain = 'https://web.archive.org';

const waybackImageUrl = /\/web\/\d{14}im_/;
const waybackPageUrl = /\/web\/[0-9]+\/(https?:\/\/.[^/]+)(.*)/i;
const isoTimestampRegex =
  /\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z)\//;

const scrapedOutputDir = 'scraped-output';

const imageExtensions =
  /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|tiff?)$/i;

async function processPageLinks(pageDomain, pagesDir) {
  const baseDir = path.join(process.cwd(), pagesDir);
  let allFilesInfo = [];

  const filesInfo = await recursiveReaddirFiles(baseDir);

  filesInfo.forEach((fileInfo) => {
    const { ext, name, path } = fileInfo;
    const dirTimestampMatch = path.match(isoTimestampRegex);
    const hrefPath = dirTimestampMatch.input.split(
      dirTimestampMatch[0]
    )[1];
    allFilesInfo.push({ ext, name, path, hrefPath });
  });

  console.log('all files info', allFilesInfo);

  allFilesInfo.forEach((file) => {
    const { ext, name, path, hrefPath } = file;
    processOneFile(ext, name, path, hrefPath);
  });
}

async function processOneFile(fileExt, fileName, filePath, hrefPath) {
  if (fileExt.includes('htm')) {
    try {
      const fileContents = await fs.readFile(filePath, {
        encoding: 'utf8',
      });
      

      const foundImgSrcs = fileContents.match(srcPattern);
      const hrefsOnPage = [...fileContents.matchAll(hrefPattern)].map(
        (match) => match[1]
      );

      let fileContentsNew = null;

      // need to replace href link if:
      // /web/...
      // web.archive.org/web/....

      if (hrefsOnPage) {
        // console.log('\x1b[36m%s\x1b[0m', filePath, hrefsOnPage);
        const anchors = [];

        for (const href of hrefsOnPage) {
          if (href.includes('http:/')) {
            // http is implied so maybe can just do contains
            // wayback url to process, either on current site or other site
            const pageLinkRaw = href.split('http:/')[1];

            const fileExists = await fsExists(
              path.join(pagesDir, pageLinkRaw)
            );

            if (fileExists) {
              console.log('original HREF🪢', href, 'raw link 🧬', pageLinkRaw);
            } else {

            }
          } else {
            // #anchor
            // single page no href (no need to process)
            // other site without wayback
            // email
            // txt file
            // console.log('NO MATCH for', href);
          }
        }
      }

      // console.log('BLEGH', href)  ;

      // fileContentsNew = fileContents.replaceAll(
      //   test,
      //   test.split('http:/')[1]
      // );

      const originalScrapedPath =
        filePath.split('scraped-output/')[1];

      const targetFileDir = originalScrapedPath.split(fileName)[0];

      const newPath = path.join(
        process.cwd(),
        'processed-output',
        targetFileDir
      );

      await fs.mkdir(newPath, { recursive: true });
      await fs.writeFile(
        path.join('processed-output', originalScrapedPath),
        fileContentsNew ? fileContentsNew : fileContents,
        'utf8'
      );
    } catch (err) {
      console.error(err);
    }
  }
}

const pageDomain = process.argv[2];
const pagesDir = process.argv[3];

if (!pageDomain) {
  console.error(
    'Please provide an Entrypoint Wayback Machine URL to begin crawl'
  );
  process.exit(1);
}

if (!pagesDir) {
  console.error('Please provide a directory to scan for page urls');
  process.exit(1);
}

processPageLinks(pageDomain, pagesDir);

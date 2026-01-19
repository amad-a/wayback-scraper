import fs from 'fs/promises';
import path from 'path';
import fsExists from 'fs.promises.exists';
import recursiveReaddirFiles from 'recursive-readdir-files';
import { prettify } from 'htmlfy';

const hrefPattern = /href=["']([^"']+)["']/gi;
const srcPattern = /src=["']([^"']+)["']/gi;
const bgPattern = /background=["']([^"']+)["']/gi;
const actionPattern = /action=["']([^"']+)["']/gi;
const targetPattern = /target=["']([^"']+)["']/gi;

const webArchiveDomain = 'https://web.archive.org';

const waybackImageUrl = /\/web\/\d{14}im_/;
const waybackPageUrl = /\/web\/[0-9]+\/(https?:\/\/.[^/]+)(.*)/i;
const isoTimestampRegex =
  /\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z)\//;

const scrapedOutputDir = 'scraped-output';
const processedOutputDir = 'processed-output';

const imageExtensions =
  /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|tiff?)$/i;

async function processPageLinks(pageDomain, pagesDir) {
  const baseDir = path.join(process.cwd(), pagesDir);
  const filesInfo = await recursiveReaddirFiles(baseDir);

  filesInfo.forEach((fileInfo) => {
    const { ext, name, path } = fileInfo;
    processOneFile(ext, name, path);
  });
}

async function editLinks(links, fileContents, type) {
  let contents = fileContents;
  for (let link of links) {
    console.log('linky', link);
    if (type === 'target') {
      console.log('targe', link);
      // contents = contents.replace(link, '_self')
      return;
    }

    if (link.includes('http:/')) {

      // http is implied so maybe can just do contains
      // wayback url to process, either on current site or other site
      let pageLinkRaw = link.split('http:/')[1];

      pageLinkRaw = pageLinkRaw.replace('www.', '');
      pageLinkRaw = pageLinkRaw.replace('www2.', '');

      const fileExists =
        // remove any anchors from url local file search
        (await fsExists(path.join(scrapedOutputDir, pageLinkRaw.split('#')[0]))) || false;

      console.log('😎', path.join(scrapedOutputDir, pageLinkRaw.split('#')[0]), fileExists);

      if (fileExists && type === 'img') {
        const pagePathNoFile = pageLinkRaw.split('#')[0].substring(0, pageLinkRaw.lastIndexOf('/'));

        await fs.mkdir(path.join(processedOutputDir, pagePathNoFile), { recursive: true });
        await fs.copyFile(
          path.join(scrapedOutputDir, pageLinkRaw.split('#')[0]),
          path.join(processedOutputDir, pageLinkRaw.split('#')[0])
        )
      }

      if (type === 'action') pageLinkRaw = "javascript:void(0)";

      if (fileExists || type === 'action') {
        contents = contents.replaceAll(link, pageLinkRaw);
      } else {
        console.log(`📄 File not found. Original link: "${link}". a: ${pageLinkRaw}`);
      }
    } else {
      if (link.includes('mailto:')) {
        contents = contents.replaceAll(link, '#');
      } else if (link.startsWith('#')) {

      } else if (link.includes('https://web-static.archive.org') || link.includes('athena.js')) {
        contents = contents.replaceAll(link, "");
      } else {

      }
      // #anchor (no need to process)
      // single page no href (no need to process)
      // other site without wayback (check if includes cur domain)
      // email (remove entirely)
      // txt file (process same as img)
    }

  }

  contents = contents.replace(targetPattern, '')

  return prettify(contents);
  // return contents
}

async function processOneFile(fileExt, fileName, filePath) {
  const originalScrapedPath = filePath.split(`${scrapedOutputDir}/`)[1];

  const targetFileDir = originalScrapedPath.split(fileName)[0];

  // ?? figure out why these are different
  const newPath = path.join(
    process.cwd(),
    processedOutputDir,
    targetFileDir
  );

  const destPath = path.join(processedOutputDir, originalScrapedPath);

  if (fileExt.includes('htm')) {
    try {
      const fileContents = await fs.readFile(filePath, {
        encoding: 'utf8',
      });


      // todo, turn pattern into function, consolidate attributes, 
      const foundImgSrcs = [...fileContents.matchAll(srcPattern)].map(
        (match) => match[1]
      );

      const hrefsOnPage = [...fileContents.matchAll(hrefPattern)].map(
        (match) => match[1]
      );

      const bgOnPage = [...fileContents.matchAll(bgPattern)].map(
        (match) => match[1]
      );

      const actionsOnPage = [...fileContents.matchAll(actionPattern)].map(
        (match) => match[1]
      );

      const targetsOnPage = [...fileContents.matchAll(targetPattern)].map(
        (match) => match[1]
      );

      let fileContentsNew = fileContents;

      if (hrefsOnPage) fileContentsNew = await editLinks(hrefsOnPage, fileContentsNew, fileName);
      if (foundImgSrcs) fileContentsNew = await editLinks(foundImgSrcs, fileContentsNew, 'img');
      if (bgOnPage) fileContentsNew = await editLinks(bgOnPage, fileContentsNew, 'img');
      if (actionsOnPage) fileContentsNew = await editLinks(actionsOnPage, fileContentsNew, 'action');
      // if (targetsOnPage) fileContentsNew = await editLinks(targetsOnPage, fileContentsNew, 'target');
      console.log('doop', fileName)
      await fs.mkdir(newPath, { recursive: true });
      await fs.writeFile(
        destPath,
        fileContentsNew ? fileContentsNew : fileContents,
        'utf8'
      );
    } catch (err) {
      console.error(err);
    }
  } else {
    // just raw copy images and other non html files that need link editing/processing
    // TODO check here or in crawler if txt, etc. files being scraped
    await fs.mkdir(newPath, { recursive: true });
    await fs.copyFile(
      filePath,
      destPath
    );
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

import { CheerioCrawler, FileDownload, PuppeteerCrawler, RequestQueue } from 'crawlee';
import { writeFileSync, readFileSync, appendFile, mkdirSync, createWriteStream } from 'fs';
import { dirname, join } from 'path';
import { get } from 'https';

readFileSync('links.csv', 'utf8');

const domain = process.argv[2];
const entryPoint = process.argv[3];

if (!domain) {
  console.error('Please provide a website domain (eg. "www.geocities.com/zuhairhm")');
  process.exit(1);
}

if (!entryPoint) {
  console.error('Please provide a website entrypoint to begin scraping from (eg. "https://web.archive.org/web/20090416055152/http://www.geocities.com/zuhairhm/Zuhair/index.html")');
  process.exit(1);
}

// const domain = 'www.geocities.com/zuhairhm'; 
// const entryPoint = 'https://web.archive.org/web/20090416055152/http://www.geocities.com/zuhairhm/Zuhair/index.html'

const crawler = new PuppeteerCrawler({
  maxRequestsPerCrawl: 50,
  async requestHandler({ $, request, enqueueLinks }) {
    // const title = $('title').text();
    // console.log(`The title of "${request.url}" is: ${title}.`);
    // appendFile('links.csv', `${request.url},`, (err) => {
    //   if (err) {
    //     console.log(err);
    //   }
    // });
    // // The default behavior of enqueueLinks is to stay on the same hostname,
    // // so it does not require any parameters.
    // // This will ensure the subdomain stays the same.
    await enqueueLinks({ globs: [] });
  },
});

const downloader = new FileDownload({
  async requestHandler({ body, request, enqueueLinks }) {

    // const pattern = /^https:\/\/web\.archive\.org\/web\/\d{14}\/http:\/\/www\.birzeit\.edu\/.*/;

    // if (pattern.test(request.url)) {
    //     console.log('🥩match', request.url);
    // }
    // writeFileSync(
    //   request.url.replace(/[^a-z0-9\.]/gi, '_') + `.html`,
    //   body
    // );

    saveFileFromUrl(request.url, body, domain);

},
});



function saveFileFromUrl (url, body, domain) {
    // Step 1: Remove the Wayback Machine prefix
    const baseUrlPattern = new RegExp(`^https:\/\/web\.archive\.org\/web\/\\d{14}\/http:\/\/(${domain.replace(/\./g, '\\.')}/.*)$`);
    const match = url.match(baseUrlPattern);

    if (!match) {
        // console.error("no match:", url);
        return;
    }

    // Step 2: Extract the path after the domain
    let filePath = match[1];

    // Step 3: Remove any hash/anchor links (e.g., #section)
    filePath = filePath.split('#')[0];

    console.log('FILE PATH', filePath);

    // Step 4: Check if the filePath ends with a valid file extension
    const fileExtensionPattern = /\.(html?|htm|asp|php|jsp|cgi)$/i;
    const hasValidExtension = filePath.endsWith('html') || filePath.endsWith('htm');

    // Step 5: If no valid extension and no trailing slash, append 'index.html'
    if (!hasValidExtension && !filePath.includes('.')) {
        console.log('NOT VALID', filePath);
        filePath = path.join(filePath, 'index.html');
    }

    // Step 6: Create the directory structure
    const dirPath = dirname(filePath);
    mkdirSync(dirPath, { recursive: true });

    writeFileSync(
      filePath,
      body
    );

}

let data = readFileSync('links.csv')
  .toString() // convert Buffer to string
  .split('\n') // split string to lines
  .map((e) => e.trim()) // remove white spaces for each line
  .map((e) => e.split(',').map((e) => e.trim())); // split each line to array

await crawler.run([
  entryPoint,
]);

await downloader.addRequests([
  entryPoint,
]);

await downloader.run();


//for tomorrow: thinking... download all/as many html/htm/etc files as possible. Then, (maybe in another file) find all image links in the html files, add them to download queue and saveFileFromUrl

//also...after file downloads, strip wayback machine fluff

//ok so, crawler.run enqueues links and then downloader adds requests ? looks to the queue and downloads links
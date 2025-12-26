// import fs from 'fs/promises';
import path from 'path';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import puppeteer from 'puppeteer';
import axios from 'axios';

const linksData = [];
const allOtherLinks = [];
const resourceLinks = [];
import { lookup } from 'mime-types';

// Utility function to ensure directories exist
const ensureDirectoryExistence = (filePath) => {
    const dirname = path.dirname(filePath);

    if (!fs.existsSync(dirname)) {
        fs.mkdirSync(dirname, { recursive: true });
    }
};

const fileExists = (filePath) => {
    if (fs.existsSync(filePath)) {
        // console.log(`${filePath} exists already`);
        return true;
    }
};

// Function to download images using Puppeteer
async function downloadImages(objects) {
    const browser = await puppeteer.launch({ headless: true });

    // const browser = await puppeteer.launch({
    //     args: ['--proxy-server=proxy-server-address:port']
    // });

    try {

        // const context = await browser.createIncognitoBrowserContext();
        const page = await browser.newPage();

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');

        await page.setExtraHTTPHeaders({
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Connection': 'keep-alive',
            'DNT': '1', // Do Not Track
        });


        for (const obj of objects) {
            const { src, relativePath, fileType } = obj;

            // Skip non-image file types
            console.log('FILETYPE', src, relativePath, fileType);
            if (fileType) {
                if (!fileType.startsWith('image/')) continue;
            }
            // Skip already downloaded files
            if (fileExists(relativePath)) continue;

            // Ensure the directory for the file exists
            ensureDirectoryExistence(relativePath);

            console.log(`Downloading: ${src} -> ${relativePath}`);

            try {
                // Go to the image URL and wait for it to load
                const response = await page.goto(src, { timeout: 0, waitUntil: 'networkidle2' });

                if (response.ok()) {
                    // Save the image to the specified relativePath
                    const buffer = await response.buffer();
                    fs.writeFileSync(relativePath, buffer);
                    console.log(`Saved: ${relativePath}`);
                } else {
                    console.warn(`Failed to fetch ${src}: HTTP ${response.status()}`);
                }
            } catch (error) {
                console.error(`Error downloading ${src}:`, error.message);
            }

            // Add a delay to prevent rate limiting or detection
            await new Promise((r) =>
                setTimeout(r, Math.random() * 200 + 100)
            );
        }
    } catch (error) {
        console.error('Error in downloading images:', error.message);
    } finally {
        await browser.close();
    }
}

function getResourceType(url) {
    return mime.lookup(url) || 'application/octet-stream';
}

//recursively search for and compile html files to scan for 
function findHtmlFiles(directory) {
    let results = [];

    // Read directory contents
    const items = fs.readdirSync(directory);

    for (const item of items) {
        const fullPath = path.join(directory, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            // Recursively search subdirectories
            results = results.concat(findHtmlFiles(fullPath));
        } else if (item.endsWith('.html') || item.endsWith('.htm')) {
            // Add HTML files to results
            results.push(fullPath);
        }
    }

    return results;
}

// process page
function processHtmlFiles(directory, homeUrl) {
    // Remove trailing slash from homeUrl if present
    homeUrl = homeUrl.replace(/\/$/, '');

    // Create regex pattern for matching wayback URLs
    // Matches /web/ followed by 14 or 17 digits, then the homeUrl
    const waybackPattern = new RegExp(`^/web/\\d{14,17}/${homeUrl}/`);

    const urlOnly = new RegExp(`${homeUrl}`);

    const waybackPatternWithDomain = new RegExp(`^https://web.archive.org/web/\\d{14,17}/${homeUrl}/`);

    // Get all HTML files recursively
    const files = findHtmlFiles(directory);
    console.log(`Found ${files.length} HTML files to process`);

    let totalModified = 0;
    files.forEach(filePath => {

        console.log(`\nProcessing ${filePath}`);

        try {
            let splitStr;
            let slashes;
            let traverseDirectory = '';
            let upDir = '../';
            // remap nested directories
            splitStr = filePath.split(homeUrl.slice(7))[1];
            slashes = ((splitStr.split("/").length - 2));
            traverseDirectory = upDir.repeat(slashes);

            // Read and parse HTML
            const html = fs.readFileSync(filePath, 'utf8');
            const dom = new JSDOM(html);
            const document = dom.window.document;

            let modified = false;
            let modificationCount = 0;

            let background = document.body.background;

            background = background.replace('http://', '');
            background = background.substring(background.search(homeUrl));

            console.log('BG', homeUrl, background, background.search(homeUrl), background.substring(background.search(homeUrl)));
            // debugger;

            // Process all links
            // document.querySelectorAll('a[href]').forEach(link => {
            //     let href = link.getAttribute('href');

            //     // Check if href matches our wayback pattern
            //     if (waybackPattern.test(href) || waybackPatternWithDomain.test(href)) {
            //         // Remove the wayback prefix
            //         if (waybackPatternWithDomain.test(href)) {
            //             href = href.replace('https://web.archive.org', '');
            //         }

            //         href = href.replace(waybackPattern, '');


            //         // Add index.html to paths ending with /
            //         if (href.endsWith('/') || href.length === 0) {
            //             href += 'index.html';
            //         }

            //         // add /index.html to dirs with no slashes
            //         // handle this better
            //         if (!(href.endsWith('/'))) {
            //             if (!(href.endsWith('.html')) && !(href.endsWith('.htm')) && !(href.endsWith('.php'))) {
            //                 href += '/index.html';
            //             }
            //         }

            //         modified = true;
            //         modificationCount++;
            //         linksData.push({
            //             'homeUrl': homeUrl,
            //             'filePath': filePath,
            //             'originalUrl': link.getAttribute('href'),
            //             'updatedUrl': traverseDirectory + href,
            //         })
            //         console.log(`  Modified href: ${link.getAttribute('href')} -> ${href}`);
            //         link.setAttribute('href', traverseDirectory + href);
            //     } else {
            //         allOtherLinks.push({
            //             'filePath': filePath,
            //             'href': href,
            //         });
            //     }

            // });

            // Process all images and other elements with src attribute

            document.querySelectorAll('[src]').forEach(element => {
                let src = element.getAttribute('src');
                console.log('IMG SRC 🤔', src);

                const waybackPattern2 = new RegExp(`^/web/\\d{14}im_/${homeUrl}/`);

                if (src.includes(homeUrl)) {
                    // Remove the wayback prefix

                    if (!src.includes('https://web.archive.org')) {
                        src = 'https://web.archive.org' + src;
                    }
                    

                    let relativePath = src.split(homeUrl)[1];

                    //ensure no duplicates
                    console.log('✨', { 'page': filePath, 'src': src, 'relativePath': '.' + relativePath, 'fileType': lookup(src) });
                    debugger;
                    if (resourceLinks.every((link) => link.relativePath !== relativePath)) {
                        resourceLinks.push({ 'page': filePath, 'src': src, 'relativePath': '.' + relativePath, 'fileType': lookup(src) });
                    }

                    console.log('IMG SRC 🐣', element, src);
                    console.log('before 🔎', element.getAttribute('src'))

                    element.setAttribute('src', traverseDirectory + relativePath.slice(1));
                    console.log('after 🧠', element.getAttribute('src'))
                    modified = true;
                    modificationCount++;
                    console.log(`Modified  /web/archive/ src: ${element.getAttribute('src')} -> ${traverseDirectory + relativePath.slice(1)}`);
                }
            });

            // Save changes back to original file if modifications were made
            if (modified) {
                fs.writeFileSync(filePath, dom.serialize(), 'utf8');
                console.log(`Updated file with ${modificationCount} modifications`);
                totalModified++;
            } else {
                console.log('  No modifications needed');
            }

        } catch (error) {
            console.error(`Error processing ${filePath}:`, error);
        }
    });

    return { totalFiles: files.length, totalModified };
}

// Get command line arguments
const args = process.argv.slice(2);

// Check if correct number of arguments provided
if (args.length !== 2) {
    console.error('Usage: node script.js <directory> <homeUrl>');
    console.error('Example: node script.js ./html-files https://example.com');
    process.exit(1);
}

const [directory, homeUrl] = args;

// Verify directory exists
if (!fs.existsSync(directory)) {
    console.error(`Error: Directory "${directory}" does not exist`);
    process.exit(1);
}

// Run the processor
try {
    console.log(`Processing files in: ${directory}`);
    console.log(`Using home URL: ${homeUrl}`);
    const { totalFiles, totalModified } = processHtmlFiles(directory, homeUrl);
    console.log('\nProcessing complete!');
    console.log(`Processed ${totalFiles} files total`);
    console.log(`Modified ${totalModified} files`);
    const allOtherLinksFiltered = allOtherLinks.filter((link) => (link.href.includes('.gif')));
    // TODO resourceLinks is where the money is 
    // console.dir(resourceLinks, { 'maxArrayLength': null });
    console.log('RESOURCE LINKS', resourceLinks);
    downloadImages(resourceLinks);
    console.log('resources len', resourceLinks.length);

} catch (error) {
    console.error('Error:', error);
    process.exit(1);
}

export default processHtmlFiles;
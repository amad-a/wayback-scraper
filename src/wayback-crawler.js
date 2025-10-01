import { PlaywrightCrawler, Dataset } from "crawlee";
import { URL } from "url";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import path from "path";
import mime from "mime-types";
import iconv from "iconv-lite";
import { detect } from "jschardet";
import fsExists from "fs.promises.exists";
import * as https from 'https';
import * as http from 'http';
// import processHtmlFiles from './wb-url-replace.js'

let crawledPages = [];
let domainDir = "";

// Helper function to extract the original domain and URL from a Wayback URL
function parseWaybackUrl(waybackUrl) {
    const match = waybackUrl.match(/\/web\/[0-9]+\/(https?:\/\/.[^/]+)(.*)/i);
    console.log("match!", match);

    return match
        ? {
            domain: new URL(match[1]).hostname,
            originalUrl: match[1] + (match[2] || ""),
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
    const urlObj = new URL(originalUrl);
    let pathname = urlObj.pathname;

    // Handle root path
    if (pathname === "/") {
        pathname = "/index.html";
    }
    // Handle paths without file extensions
    else if (!path.extname(pathname)) {
        const ext = mime.extension(contentType) || "html";
        pathname = `${pathname.replace(/\/$/, "")}/index.${ext}`;
    }

    // Create full local path
    return path.join(baseDir, urlObj.hostname, pathname);
}

// Helper function to detect and convert encoding
async function handleHtmlEncoding(content, contentType, log) {
    // If content is already a string, we need to convert it to a buffer first
    const contentBuffer = Buffer.isBuffer(content)
        ? content
        : Buffer.from(content);

    // Try to detect encoding from content-type header
    let encoding = "utf-8";
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
        if (encoding === "utf-8" || encoding === "ascii" || encoding === "utf8") {
            htmlContent = contentBuffer.toString("utf8");
        } else if (iconv.encodingExists(encoding)) {
            htmlContent = contentBuffer.toString("utf8");
        } else {
            log.warning(`Unsupported encoding: ${encoding}, falling back to UTF-8`);
            htmlContent = contentBuffer.toString("utf8");
        }
    } catch (error) {
        log.error(
            `Error converting encoding: ${error.message}, falling back to UTF-8`
        );
        htmlContent = contentBuffer.toString("utf8");
    }

    // Clean up the HTML content
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
                ""
            )
            // Remove Wayback Machine scripts
            .replace(/<script>[\s\S]*?<!-- End Wayback Rewrite JS Include -->/g, "")
            // Clean up any empty lines left by removals
            .replace(/^\s*[\r\n]/gm, "")
    );
}

async function crawlWaybackMachine(startUrl, dirBound) {
    const parsedUrl = parseWaybackUrl(startUrl);
    if (!parsedUrl) {
        console.error("Could not parse Wayback URL");
        return;
    }

    const { domain, originalUrl } = parsedUrl;
    console.log("PARSED URL", parsedUrl);
    domainDir = domain;
    // console.log(`Original domain: ${domain}`);
    // console.log(`Original URL: ${originalUrl}`);

    // Create base download directory
    const baseDir = path.join(process.cwd(), "scraped-sites");
    await ensureDir(baseDir);

    // Initialize the crawler
    const crawler = new PlaywrightCrawler({
        // Configure browser pool
        browserPoolOptions: {
            useFingerprints: true,
        },
        launchContext: {
            launchOptions: {
                headless: true,
                args: [
                    "--disable-blink-features=AutomationControlled",
                    "--disable-features=IsolateOrigins,site-per-process",
                ],
            },
        },

        maxConcurrency: 20,
        maxRequestRetries: 3,
        requestHandlerTimeoutSecs: 60,

        // Handler for each page
        async requestHandler({ request, page, enqueueLinks, log, response }) {
            log.info(`Processing ${request.url}`);

            // if (!['.gif','.jpg','.jpeg','.png','.bmp'].some(ext => path.extname(request.url).toLowerCase())) {
            try {
                // Get content type from response headers
                const contentType = response.headers()["content-type"] || "text/html";

                // Different handling based on content type
                let content;
                if (contentType.includes("text/html")) {
                    // Wait for page to load for HTML content
                    await page.waitForLoadState("networkidle");

                    // Set headers to avoid detection
                    await page.setExtraHTTPHeaders({
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                        Accept:
                            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                        "Accept-Language": "en-US,en;q=0.5",
                        "Upgrade-Insecure-Requests": "1",
                    });

                    // Extract all image URLs from the page
                    const images = await page.evaluate(() => {
                        const imgElements = document.querySelectorAll("img");
                        const bgImages = [];

                        // Get all elements with background images
                        document.querySelectorAll("*").forEach((el) => {
                            const bg = window.getComputedStyle(el).backgroundImage;
                            if (bg && bg !== "none") {
                                const match = bg.match(/url\(['"]?([^'"]+)['"]?\)/);
                                if (match) bgImages.push(match[1]);
                            }
                        });

                        return {
                            imgSrc: Array.from(imgElements).map((img) => ({
                                src: img.src,
                                alt: img.alt || "",
                                width: img.naturalWidth,
                                height: img.naturalHeight,
                            })),
                            backgroundImages: bgImages,
                        };
                    });

                    console.log("IMAGES 🔥", images);

                    // Combine all image URLs
                    const allImageUrls = [
                        ...images.imgSrc.map(img => img.src),
                        ...images.backgroundImages
                    ];

                    // Remove duplicates
                    const uniqueUrls = [...new Set(allImageUrls)];

                    log.info(`Found ${uniqueUrls.length} unique images on ${request.url}`);

                    // Download each image
                    for (const imgUrl of uniqueUrls) {
                        try {
                            await downloadImage(imgUrl, baseDir, log);
                        } catch (err) {
                            log.warning(`Failed to download ${imgUrl}: ${err.message}`);
                        }
                    }
                    // Add random delay for HTML pages
                    await new Promise((r) => setTimeout(r, Math.random() * 200 + 100));

                    // Get raw content first
                    const rawContent = await response.body();

                    // Handle encoding detection and conversion
                    content = await handleHtmlEncoding(rawContent, contentType, log);
                } else if (contentType.startsWith("image/")) {
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
                    contentType.startsWith("image/") ||
                    (!contentType.includes("text/html") && Buffer.isBuffer(content))
                ) {
                    await fs.writeFileSync(localPath, content);
                } else if (contentType.includes("text/html")) {
                    // For HTML content, always save as UTF-8
                    if (!fileExists) {
                        await fs.writeFile(localPath, content, "utf8");
                    } else {
                        console.log(localPath, "already exists 📂");
                    }
                }
                // else {
                //     // For other text-based content
                //     await fs.writeFile(localPath, content);
                // }

                log.info(`Saved to ${localPath}`);

                // Only parse links for HTML pages
                if (contentType.includes("text/html")) {
                    // Extract and enqueue links from the same domain
                    await enqueueLinks({
                        globs: [`**/${dirBound}/**`],
                        transformRequestFunction: (req) => {
                            // Ensure we're only crawling Wayback Machine URLs
                            // TODO: also check here if url is already downloaded
                            // TODO: check here if url is image
                            if (parseWaybackUrl(req.url)) {
                                if (
                                    crawledPages.includes(
                                        parseWaybackUrl(req.url).originalUrl.replace(/#.*$/, "")
                                    ) ||
                                    !req.url.includes(dirBound)
                                ) {
                                    return false;
                                }
                            }
                            if (parseWaybackUrl(req.url))
                                crawledPages.push(parseWaybackUrl(req.url).originalUrl);
                            console.log("🐞", crawledPages);
                            return req;
                        },
                    });
                }
            } catch (error) {
                log.error(`Error processing ${request.url}: ${error.message}`);
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

// Helper function to download images
async function downloadImage(url, baseDir, log) {
    return new Promise((resolve, reject) => {
        try {
            // Extract the original URL from Web Archive format
            let targetUrl = url;
            let filePath;

            // Check if it's a Web Archive URL
            const archiveMatch = url.match(
                /https?:\/\/web\.archive\.org\/web\/\d+im_\/(https?:\/\/.+)/
            );

            if (archiveMatch) {
                // Extract the original URL
                targetUrl = archiveMatch[1];
            }

            // Parse the target URL to get path structure
            const urlObj = new URL(targetUrl);
            const hostname = urlObj.hostname;
            const pathname = urlObj.pathname;

            // Create directory structure: scraped-sites/hostname/path
            const dirPath = path.join(baseDir, hostname, path.dirname(pathname));
            const filename = path.basename(pathname) || "index.html";
            filePath = path.join(baseDir, hostname, pathname);

            // Ensure directory exists
            fs.mkdir(dirPath, { recursive: true })
                .then(() => {
                    // Choose http or https based on original archive URL
                    const client = url.startsWith("https") ? https : http;

                    client
                        .get(url, (response) => {
                            // Handle redirects
                            if (response.statusCode === 301 || response.statusCode === 302) {
                                const redirectUrl = response.headers.location;
                                log.info(`Redirected to: ${redirectUrl}`);
                                downloadImage(redirectUrl, baseDir, log)
                                    .then(resolve)
                                    .catch(reject);
                                return;
                            }

                            if (response.statusCode !== 200) {
                                reject(new Error(`Status ${response.statusCode}`));
                                return;
                            }

                            const fileStream = createWriteStream(filePath);
                            response.pipe(fileStream);

                            fileStream.on("finish", () => {
                                fileStream.close();
                                log.info(`Downloaded: ${filePath}`);
                                resolve(filePath);
                            });

                            fileStream.on("error", (err) => {
                                fs.unlink(filePath).catch(() => { });
                                reject(err);
                            });
                        })
                        .on("error", reject);
                })
                .catch(reject);
        } catch (err) {
            reject(err);
        }
    });
}

function writeToFile() {
    let file = createWriteStream(`scraped-sites/${domainDir}/page-list.txt`);
    file.on("error", function (err) {
        /* error handling */
    });
    crawledPages = crawledPages.sort();
    crawledPages.forEach((element) => file.write(element + "\n"));
    file.end();
}

// Example usage
const waybackUrl = process.argv[2];
const waybackDir = process.argv[3];
if (!waybackUrl) {
    console.error("Please provide a Wayback Machine URL as an argument");
    process.exit(1);
}

if (!waybackDir) {
    console.error(
        "Please provide a Wayback Machine containing path to scan for sites as an argument"
    );
    process.exit(1);
}

crawlWaybackMachine(waybackUrl, waybackDir)
    .then(() => console.log("Crawling completed! crawled urls:", crawledPages))
    .then(() => writeToFile())
    .then(() => console.log("urls written to file"))
    //TODO: Auto process link changes and images here
    .catch((error) => console.error("Crawling failed:", error));

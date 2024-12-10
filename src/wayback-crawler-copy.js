import { PlaywrightCrawler, Dataset } from 'crawlee';
import { URL } from 'url';
import fs from 'fs/promises';
import path from 'path';
import mime from 'mime-types';
import iconv from 'iconv-lite';
import { detect } from 'jschardet';
import crypto from 'crypto';

// Constants for configuration
const CONFIG = {
    CONCURRENT_REQUESTS: 2,
    MAX_RETRIES: 3,
    TIMEOUT_SECS: 60,
    MIN_REQUEST_DELAY: 100,
    MAX_REQUEST_DELAY: 300,
    SUPPORTED_CONTENT_TYPES: {
        HTML: 'text/html',
        CSS: 'text/css',
        JAVASCRIPT: 'application/javascript',
        JSON: 'application/json'
    },
    SKIP_EXTENSIONS: new Set(['.gif', '.jpg', '.jpeg', '.png', '.bmp', '.pdf', '.zip', '.tar', '.gz']),
    DEFAULT_ENCODING: 'utf-8'
};

// File tracking class
class FileTracker {
    constructor(baseDir) {
        this.baseDir = baseDir;
        this.processedUrlsFile = path.join(baseDir, 'processed_urls.json');
        this.processedUrls = new Map();
        this.isDirty = false;
    }

    async load() {
        try {
            const data = await fs.readFile(this.processedUrlsFile, 'utf8');
            const entries = JSON.parse(data);
            this.processedUrls = new Map(entries);
            console.log(`Loaded ${this.processedUrls.size} processed URLs`);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.warn(`Error loading processed URLs: ${error.message}`);
            }
        }
    }

    async save() {
        if (this.isDirty) {
            try {
                const entries = Array.from(this.processedUrls.entries());
                await fs.writeFile(
                    this.processedUrlsFile,
                    JSON.stringify(entries, null, 2),
                    'utf8'
                );
                this.isDirty = false;
                console.log(`Saved ${entries.length} processed URLs`);
            } catch (error) {
                console.error(`Error saving processed URLs: ${error.message}`);
            }
        }
    }

    isProcessed(url, contentHash) {
        url = url.slice(43);
        console.log('is', url)
        const previousHash = this.processedUrls.get(url);
        return this.processedUrls.includes(url);
    }

    markProcessed(url, contentHash) {
        url = url.slice(43);
        console.log('mark', url)
        this.processedUrls.set(url, contentHash);
        this.isDirty = true;
    }

    // Save periodically to prevent data loss
    async startAutoSave(intervalMs = 60000) {
        this.autoSaveInterval = setInterval(() => {
            this.save().catch(console.error);
        }, intervalMs);
    }

    async stopAutoSave() {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
            await this.save();
        }
    }
}


// Helper function to extract the original domain and URL from a Wayback URL
function parseWaybackUrl(waybackUrl) {
    const match = waybackUrl.match(/\/web\/[0-9]+\/(https?:\/\/.[^/]+)(.*)/i);
    return match ? {
        domain: new URL(match[1]).hostname,
        originalUrl: match[1] + (match[2] || '')
    } : null;
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
    if (pathname === '/') {
        pathname = '/index.html';
    }
    // Handle paths without file extensions
    else if (!path.extname(pathname)) {
        const ext = mime.extension(contentType) || 'html';
        pathname = `${pathname.replace(/\/$/, '')}/index.${ext}`;
    }

    // Create full local path
    return path.join(baseDir, urlObj.hostname, pathname);
}

// Helper function to detect and convert encoding
async function handleHtmlEncoding(content, contentType, log) {
    // If content is already a string, we need to convert it to a buffer first
    const contentBuffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
    
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
        if (encoding === 'utf-8' || encoding === 'ascii' || encoding === 'utf8') {
            htmlContent = contentBuffer.toString('utf8');
        } else if (iconv.encodingExists(encoding)) {
            htmlContent = iconv.decode(contentBuffer, encoding);
        } else {
            log.warning(`Unsupported encoding: ${encoding}, falling back to UTF-8`);
            htmlContent = contentBuffer.toString('utf8');
        }
    } catch (error) {
        log.error(`Error converting encoding: ${error.message}, falling back to UTF-8`);
        htmlContent = contentBuffer.toString('utf8');
    }

    // Clean up the HTML content
    return htmlContent
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
        .replace(/^\s*[\r\n]/gm, '');
}

// async function crawlWaybackMachine(startUrl) {
//     const parsedUrl = parseWaybackUrl(startUrl);
//     console.log('💡 parsed', parsedUrl);
//     if (!parsedUrl) {
//         console.error('Could not parse Wayback URL');
//         return;
//     }

//     const { domain, originalUrl } = parsedUrl;
//     console.log(`Original domain: ${domain}`);
//     console.log(`Original URL: ${originalUrl}`);
    
//     // Create base download directory
//     const baseDir = path.join(process.cwd(), 'downloads');
//     await ensureDir(baseDir);

//     // Initialize the crawler
//     const crawler = new PlaywrightCrawler({
//         // Configure browser pool
//         browserPoolOptions: {
//             useFingerprints: true,
//         },
//         launchContext: {
//             launchOptions: {
//                 headless: true,
//                 args: [
//                     '--disable-blink-features=AutomationControlled',
//                     '--disable-features=IsolateOrigins,site-per-process'
//                 ]
//             }
//         },

//         maxConcurrency: 2,
//         maxRequestRetries: 3,
//         requestHandlerTimeoutSecs: 60,

//         // Handler for each page
//         async requestHandler({ request, page, enqueueLinks, log, response }) {
//             log.info(`Processing ${request.url}`);

//             if (!['.gif','.jpg','.jpeg','.png','.bmp'].some(ext => path.extname(request.url).toLowerCase())) {
//                 try {
//                     // Get content type from response headers
//                     const contentType = response.headers()['content-type'] || 'text/html';
                    
//                     // Different handling based on content type
//                     let content;
//                     if (contentType.includes('text/html')) {
//                         // Wait for page to load for HTML content
//                         await page.waitForLoadState('networkidle');
                        
//                         // Set headers to avoid detection
//                         await page.setExtraHTTPHeaders({
//                             'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
//                             'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
//                             'Accept-Language': 'en-US,en;q=0.5',
//                             'Upgrade-Insecure-Requests': '1',
//                         });
    
//                         // Add random delay for HTML pages
//                         await new Promise(r => setTimeout(r, Math.random() * 200 + 100));
    
//                         // Get raw content first
//                         const rawContent = await response.body();
                        
//                         // Handle encoding detection and conversion
//                         content = await handleHtmlEncoding(rawContent, contentType, log);
//                     } else if (contentType.startsWith('image/')) {
//                         // For images, get the buffer directly
//                         content = await response.body();
//                     } else {
//                         // For other types (CSS, JS, etc.), get the raw buffer
//                         content = await response.body();
//                     }
    
//                     // Parse the original URL from the Wayback URL
//                     const parsedUrl = parseWaybackUrl(request.url);
//                     if (!parsedUrl) {
//                         log.error(`Could not parse URL: ${request.url}`);
//                         return;
//                     }
    
//                     // Get the local file path
//                     const localPath = getLocalFilePath(baseDir, parsedUrl.originalUrl, contentType);
                    
//                     // Ensure the directory exists
//                     await ensureDir(path.dirname(localPath));
    
//                     // Save the content based on its type
//                     if (contentType.startsWith('image/') || (!contentType.includes('text/html') && Buffer.isBuffer(content))) {
//                         await fs.writeFileSync(localPath, content);
//                     } else if (contentType.includes('text/html')) {
//                         // For HTML content, always save as UTF-8
//                         await fs.writeFile(localPath, content, 'utf8');
//                     } else {
//                         // For other text-based content
//                         await fs.writeFile(localPath, content);
//                     }
                    
//                     log.info(`Saved to ${localPath}`);
    
//                     // Only parse links for HTML pages
//                     if (contentType.includes('text/html')) {
//                         // Extract and enqueue links from the same domain
//                         await enqueueLinks({
//                             globs: [`**/${domain}/**`],
//                             transformRequestFunction: (req) => {
//                                 // Ensure we're only crawling Wayback Machine URLs
//                                 if (!req.url.includes('web.archive.org')) {
//                                     return false;
//                                 }
//                                 return req;
//                             },
//                         });
//                     }
//                 } catch (error) {
//                     log.error(`Error processing ${request.url}: ${error.message}`);
//                 }
//             }
//         },

//         // Failure handler
//         failedRequestHandler: async ({ request, log }) => {
//             log.error(`Failed to process ${request.url}`);
//         },
//     });

//     // Start the crawler
//     await crawler.run([startUrl]);
// }

// Main crawler function with file tracking
async function crawlWaybackMachine(startUrl, options = {}) {
    console.log('start ul', startUrl);
    const parsedUrl = parseWaybackUrl(startUrl);
    if (!parsedUrl) {
        throw new Error('Invalid Wayback Machine URL');
    }

    const { domain, originalUrl, timestamp } = parsedUrl;
    console.log(`Starting crawl of ${domain}`);
    
    const baseDir = path.join(process.cwd(), 'downloads');
    await ensureDir(baseDir);

    // Initialize file tracker
    const fileTracker = new FileTracker(baseDir);
    await fileTracker.load();
    await fileTracker.startAutoSave();

    const stats = {
        processed: 0,
        failed: 0,
        skipped: 0,
        unchanged: 0,
        byContentType: {}
    };

    const crawler = new PlaywrightCrawler({
        // Configure browser pool
        browserPoolOptions: {
            useFingerprints: true,
        },
        launchContext: {
            launchOptions: {
                headless: true,
                args: [
                    '--disable-blink-features=AutomationControlled',
                    '--disable-features=IsolateOrigins,site-per-process'
                ]
            }
        },

        maxConcurrency: 2,
        maxRequestRetries: 3,
        requestHandlerTimeoutSecs: 60,

        async requestHandler({ request, page, enqueueLinks, log, response }) {
            const url = request.url;
            log.info(`Processing: ${url}`);

            try {
                // Skip files with unwanted extensions
                if (CONFIG.SKIP_EXTENSIONS.has(path.extname(url).toLowerCase())) {
                    stats.skipped++;
                    log.info(`Skipping file: ${url}`);
                    return;
                }

                const contentType = response.headers()['content-type'] || CONFIG.SUPPORTED_CONTENT_TYPES.HTML;
                stats.byContentType[contentType] = (stats.byContentType[contentType] || 0) + 1;

                // Get content and calculate hash
                let content;
                if (contentType.includes(CONFIG.SUPPORTED_CONTENT_TYPES.HTML)) {
                    await page.waitForLoadState('networkidle');
                    await new Promise(r => setTimeout(r, 
                        Math.random() * (CONFIG.MAX_REQUEST_DELAY - CONFIG.MIN_REQUEST_DELAY) + CONFIG.MIN_REQUEST_DELAY
                    ));

                    const rawContent = await response.body();
                    content = await handleHtmlEncoding(rawContent, contentType, log);
                    // content = cleanHtmlContent(content);
                } else {
                    content = await response.body();
                }

                // Calculate content hash
                const contentHash = crypto
                    .createHash('sha256')
                    .update(Buffer.isBuffer(content) ? content : Buffer.from(content))
                    .digest('hex');

                // Check if file has changed
                if (fileTracker.isProcessed(url, contentHash)) {
                    stats.unchanged++;
                    log.info(`Skipping unchanged file: ${url}`);
                    return;
                }

                const parsedUrl = parseWaybackUrl(url);
                if (!parsedUrl) {
                    throw new Error(`Invalid URL structure: ${url}`);
                }

                const localPath = getLocalFilePath(baseDir, parsedUrl.originalUrl, contentType);
                await ensureDir(path.dirname(localPath));

                if (Buffer.isBuffer(content)) {
                    await fs.writeFile(localPath, content);
                } else {
                    await fs.writeFile(localPath, content, 'utf8');
                }

                // Mark file as processed
                /// change url to get rid of timestamp
                fileTracker.markProcessed(url, contentHash);
                stats.processed++;
                log.info(`Saved: ${localPath}`);

                // Only enqueue links for HTML content
                if (contentType.includes(CONFIG.SUPPORTED_CONTENT_TYPES.HTML)) {
                    await enqueueLinks({
                        globs: [`**/${domain}/**`],
                        transformRequestFunction: (req) => {
                            return req.url.includes('web.archive.org') ? req : false;
                        },
                    });
                }

            } catch (error) {
                stats.failed++;
                log.error(`Failed processing ${url}: ${error.message}`);
                throw error;
            }
        },

        // Failure handler
        failedRequestHandler: async ({ request, log }) => {
            log.error(`Failed to process ${request.url}`);
        },
    });

    try {
        await crawler.run([startUrl]);
        
        // Stop auto-save and ensure final save
        await fileTracker.stopAutoSave();
        
        // Save crawl statistics
        await fs.writeFile(
            path.join(baseDir, 'crawl_stats.json'),
            JSON.stringify(stats, null, 2),
            'utf8'
        );
        
        console.log('Crawl completed successfully');
        console.log('Statistics:', stats);
    } catch (error) {
        await fileTracker.stopAutoSave();
        console.error('Crawl failed:', error);
        throw error;
    }
}

// Example usage
const waybackUrl = process.argv[2];
console.log('w', waybackUrl);
if (!waybackUrl) {
    console.error('Please provide a Wayback Machine URL as an argument');
    process.exit(1);
}

crawlWaybackMachine(waybackUrl)
    .then(() => console.log('Crawling completed'))
    .catch(error => console.error('Crawling failed:', error));

export default crawlWaybackMachine;

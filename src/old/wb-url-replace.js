// import fs from 'fs/promises';
import path from 'path';
import { JSDOM } from 'jsdom';
import fs from 'fs';

const linksData = [];
const allOtherLinks = [];
const resourceLinks = [];

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
    const waybackPatternWithDomain = new RegExp(`^https://web.archive.org/web/\\d{14,17}/${homeUrl}/`);

    // Get all HTML files recursively
    const files = findHtmlFiles(directory);
    console.log(`Found ${files.length} HTML files to process`);

    let totalModified = 0;
    files.forEach(filePath => {

        console.log(`\nProcessing ${filePath}`);

        try {
            // Read and parse HTML
            const html = fs.readFileSync(filePath, 'utf8');
            const dom = new JSDOM(html);
            const document = dom.window.document;
            
            let modified = false;
            let modificationCount = 0;

            // Process all links
            document.querySelectorAll('a[href]').forEach(link => {
                let href = link.getAttribute('href');

                // Check if href matches our wayback pattern
                if (waybackPattern.test(href) || waybackPatternWithDomain.test(href)) {
                    // Remove the wayback prefix
                    if (waybackPatternWithDomain.test(href)) {
                        href = href.replace('https://web.archive.org', '');
                    }

                    href = href.replace(waybackPattern, '');
                    
                    // remap nested directories
                    const splitStr = filePath.split(homeUrl.slice(7))[1];
                    const slashes = ((splitStr.split("/").length - 2));
                    // Add index.html to paths ending with /
                    if (href.endsWith('/') || href.length === 0) {
                        href += 'index.html';
                    }

                    // add /index.html to dirs with no slashes
                    // handle this better
                    if (!(href.endsWith('/'))) {
                        if (!(href.endsWith('.html')) && !(href.endsWith('.htm')) && !(href.endsWith('.php'))) {
                            href += '/index.html';
                        }
                    }

                    let traverseDirectory =  '';
                    let upDir = '../'
                    traverseDirectory = upDir.repeat(slashes);
                    
                    modified = true;
                    modificationCount++;
                    linksData.push( {
                        'homeUrl': homeUrl,
                        'filePath': filePath,
                        'originalUrl': link.getAttribute('href'),
                        'updatedUrl': traverseDirectory + href,
                    })
                    console.log(`  Modified href: ${link.getAttribute('href')} -> ${href}`);
                    link.setAttribute('href', traverseDirectory + href);
                } else {
                    allOtherLinks.push({
                        'filePath': filePath,
                        'href': href,
                    });
                }

            });

            // Process all images and other elements with src attribute
            document.querySelectorAll('[src]').forEach(element => {
                let src = element.getAttribute('src');

                const waybackPattern2 = new RegExp(`^/web/\\d{14}im_/${homeUrl}/`);
                
                if (waybackPattern2.test(src)) {
                    // Remove the wayback prefix
                    src = 'https://web.archive.org' + src;

                    let relativePath = src.split(homeUrl)[1];

                    //ensure no duplicates
                    if (resourceLinks.every((link) => link.relativePath !== relativePath)) {
                        resourceLinks.push({'page': filePath ,'src': src, 'relativePath': relativePath});
                    }
                    
                    element.setAttribute('src', src);
                    modified = true;
                    modificationCount++;
                    console.log(`Modified  /web/archive/ src: ${element.getAttribute('src')} -> ${src}`);
                }
            });

            // Save changes back to original file if modifications were made
            if (modified) {
                // fs.writeFileSync(filePath, dom.serialize(), 'utf8');
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
    console.dir(resourceLinks, {'maxArrayLength': null});
    console.log('resources len', resourceLinks.length);

} catch (error) {
    console.error('Error:', error);
    process.exit(1);
}

export default processHtmlFiles;
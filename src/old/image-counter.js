import { readdir, readFile, writeFile } from 'fs/promises';
import { join, extname } from 'path';
import * as cheerio from 'cheerio';

// Get the directory path from command-line arguments
const directoryPath = process.argv[2];

if (!directoryPath) {
    console.error('Please provide a directory path to scan html files for img sources.');
    process.exit(1);
  }

// Regular expression to match image URLs starting with '/web/{14-digit-number}im_/'
const urlPattern = /^\/web\/\d{14}im_\//;

// Function to extract all image URLs from an HTML file and filter by the pattern
async function extractImageUrls(filePath) {
  const html = await readFile(filePath, 'utf-8');
  const $ = cheerio.load(html);
  let imgUrls = [];

  $('img').each((_, img) => {
    const src = $(img).attr('src');
    if (src && urlPattern.test(src)) {
      imgUrls.push(src);
    }
  });

  return imgUrls;
}

// Function to scan a directory and its subdirectories for .html or .htm files and extract img src attributes
async function scanDirectoryForImages(directoryPath) {
  let imageUrls = [];

  try {
    const files = await readdir(directoryPath, { withFileTypes: true });

    for (const file of files) {
      const filePath = join(directoryPath, file.name);
      
      if (file.isDirectory()) {
        // Recursively search in subdirectories
        const subDirUrls = await scanDirectoryForImages(filePath);
        imageUrls = imageUrls.concat(subDirUrls);
      } else if (file.isFile()) {
        const ext = extname(file.name).toLowerCase();
        if (ext === '.html' || ext === '.htm') {
          const urls = await extractImageUrls(filePath);
          imageUrls = imageUrls.concat(urls);
        }
      }
    }

    return imageUrls;
  } catch (error) {
    console.error(`Error reading files: ${error}`);
  }
}

// Function to write image URLs to a text file
async function writeImageUrlsToFile(imageUrls, outputPath) {
  try {
    const data = imageUrls.join('\n');
    await writeFile(outputPath, data, 'utf-8');
    console.log(`Image URLs written to ${outputPath}`);
  } catch (error) {
    console.error(`Error writing file: ${error}`);
  }
}

// Main function to handle the process
async function main() {
  if (!directoryPath) {
    console.error('Please provide a directory as an argument.');
    process.exit(1);
  }

  const imageUrls = await scanDirectoryForImages(directoryPath);
  if (imageUrls.length > 0) {
    const outputPath = join(directoryPath, 'image-urls.txt');
    await writeImageUrlsToFile(imageUrls, outputPath);
  } else {
    console.log('No image URLs found.');
  }
}

// Run the main function
main();

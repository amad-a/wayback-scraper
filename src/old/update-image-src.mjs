import { readdir, readFile, writeFile, stat } from 'fs/promises';
import { join, extname } from 'path';

// Regex to match the src attribute for img tags
const imgSrcRegex = /<img\s+[^>]*src="(\/web\/\d{14}im_\/[^"]+)"/gi;
const prependUrl = 'https://web.archive.org';

// Function to recursively find .html and .htm files
async function findHtmlFiles(dir) {
  let files = [];
  const items = await readdir(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = join(dir, item.name);
    if (item.isDirectory()) {
      files = files.concat(await findHtmlFiles(fullPath));
    } else if (item.isFile() && (extname(item.name) === '.html' || extname(item.name) === '.htm')) {
      files.push(fullPath);
    }
  }
  return files;
}

// Function to modify the img src attributes in an HTML file
async function modifyHtmlFile(filePath) {
  try {
    let content = await readFile(filePath, 'utf-8');
    let modifiedContent = content.replace(imgSrcRegex, (match, src) => {
      // Prepend the base URL to the src
      const newSrc = `${prependUrl}${src}`;
      return match.replace(src, newSrc);
    });

    if (modifiedContent !== content) {
      await writeFile(filePath, modifiedContent, 'utf-8');
      console.log(`Updated ${filePath}`);
    } else {
      console.log(`No changes in ${filePath}`);
    }
  } catch (error) {
    console.error(`Error processing file ${filePath}: ${error}`);
  }
}

// Main function to process all HTML/HTM files in the directory
async function processDirectory(directory) {
  try {
    const htmlFiles = await findHtmlFiles(directory);

    if (htmlFiles.length === 0) {
      console.log('No HTML/HTM files found.');
      return;
    }

    for (const file of htmlFiles) {
      await modifyHtmlFile(file);
    }

    console.log('Processing completed.');
  } catch (error) {
    console.error(`Error processing directory: ${error}`);
  }
}

// Get the directory input from command-line arguments
const directory = process.argv[2];

if (!directory) {
  console.error('Please provide a directory path as an argument.');
  process.exit(1);
}

// Start processing
processDirectory(directory);

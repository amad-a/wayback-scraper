import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";

// Step 1: Get the file name from command-line arguments
const imageUrlFile = process.argv[2];
if (!imageUrlFile) {
  console.error("Please provide a text file with image URLs as an argument.");
  process.exit(1);
}

// Function to strip the '/web/<14-digit-number>im_/' from the URL
function stripWebArchivePrefix(url) {
  return url.match(/^.{53}(.*)/)[1]; // Keep only the original URL after im_/
}

function filterByFirstMatch(uniqueStrings, stringArray) {
  const foundMatches = new Set(); // To keep track of found unique strings
  return stringArray.filter((str) => {
    // Find the first unique string that matches this string
    const firstMatch = uniqueStrings.find((unique) => str.includes(unique));
    if (firstMatch && !foundMatches.has(firstMatch)) {
      foundMatches.add(firstMatch);
      return true; // Include this string in the result
    }
    return false; // Skip this string if a match was already found
  });
}

// Step 2: Read URLs from the specified text file and filter out duplicates
let urls;
try {
  // Read the file and map the URLs, stripping out the '/web/<14-digit-number>im_/' prefix for duplicate checking
  const rawUrls = fs
    .readFileSync(imageUrlFile, "utf-8")
    .split("\n")
    .filter(Boolean) // Remove empty lines
    .map((url) => `https://web.archive.org${url.trim()}`); // Prepend base URL

  // Use a Set to filter out duplicates after stripping the web archive prefix
  const uniqueUrls = [...new Set(rawUrls.map(stripWebArchivePrefix))];

  urls = filterByFirstMatch(uniqueUrls, rawUrls);
  console.log("urls", urls);
} catch (error) {
  console.error("Error reading the file:", error.message);
  process.exit(1);
}

// Step 3: Download images using Puppeteer
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  for (const imageUrl of urls) {
    try {
      await page.goto(imageUrl, { waitUntil: "networkidle2" });

      // Get the image source (assuming the image is in an <img> tag)
      const imageSrc = await page.evaluate(() => {
        const img = document.querySelector("img");
        return img ? img.src : null;
      });

      if (imageSrc) {
        // Extract the original path from the imageSrc, skipping the '/web/<14-digit-number>im_/http://'
        const originalPathMatch = imageSrc.match(/^.{53}(.*)/);
        if (originalPathMatch) {
          const originalPath = originalPathMatch[1]; // Get the matched original URL path
          const savePath = path.join(process.cwd(), originalPath);

          // Create directories if they don't exist
          fs.mkdirSync(path.dirname(savePath), { recursive: true });

          const viewSource = await page.goto(imageSrc);
          fs.writeFileSync(savePath, await viewSource.buffer());
          console.log(`Downloaded: ${savePath}`);
        } else {
          console.error(`Could not extract original path from ${imageSrc}`);
        }
      } else {
        console.error(`No image found for ${imageUrl}`);
      }

      // Random delay to avoid rate limiting
      const randomDelay = Math.floor(Math.random() * (2000 - 500 + 1)) + 500;
      await new Promise((resolve) => setTimeout(resolve, randomDelay));
    } catch (error) {
      console.error(`Failed to download ${imageUrl}:`, error.message);
    }
  }

  await browser.close();
  console.log("All images processed.");
})();

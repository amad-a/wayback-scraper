import fs from "fs";
import path from "path";
import axios from "axios";
import { BasicCrawler } from "crawlee";

// Step 1: Get the file name from command-line arguments
const imageUrlFile = process.argv[2];
if (!imageUrlFile) {
  console.error("Please provide a text file with image URLs as an argument.");
  process.exit(1);
}

// Step 2: Read URLs from the specified text file
let urls;
try {
  urls = fs
    .readFileSync(imageUrlFile, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((url) => `https://web.archive.org${url.trim()}`); // Prepend the base URL
} catch (error) {
  console.error("Error reading the file:", error.message);
  process.exit(1);
}

// Step 3: Function to download an image from a URL
async function downloadImage(url, savePath) {
  const response = await axios({
    url,
    method: "GET",
    responseType: "stream",
  });

  const writer = fs.createWriteStream(savePath);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

// Step 4: Set up the crawler to process each URL
const crawler = new BasicCrawler({
  async requestHandler({ request }) {
    const imageUrl = request.url;
    const imageName = path.basename(imageUrl); // Extracts the file name from the URL
    const savePath = path.join(process.cwd(), "images", imageName);

    try {
      await downloadImage(imageUrl, savePath);
      console.log(`Downloaded: ${imageName}`);
    } catch (error) {
      console.error(`Failed to download ${imageUrl}:`, error.message);
    }
  },
});

// Step 5: Add the URLs to the request queue
(async () => {
  try {
    await crawler.run(urls.map((url) => ({ url })));
    console.log("All images downloaded.");
  } catch (error) {
    console.error("Error during crawling:", error.message);
  }
})();

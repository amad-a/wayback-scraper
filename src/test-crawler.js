import { PlaywrightCrawler } from 'crawlee';

const crawler = new PlaywrightCrawler({
    requestHandler: async ({ page, request, enqueueLinks }) => {
        console.log(`Processing: ${request.url}`);
        if (request.label === 'DETAIL') {
            // We're not doing anything with the details yet.
        } else if (request.label === 'CATEGORY') {
            // We are now on a category page. We can use this to paginate through and enqueue all products,
            // as well as any subsequent pages we find

            await page.waitForSelector('.product-item > a');
            await enqueueLinks({
                selector: '.product-item > a',
                label: 'DETAIL', // <= note the different label
            });

            // Now we need to find the "Next" button and enqueue the next page of results (if it exists)
            const nextButton = await page.$('a.pagination__next');
            if (nextButton) {
                await enqueueLinks({
                    selector: 'a.pagination__next',
                    label: 'CATEGORY', // <= note the same label
                });
            }
        } else {
            // This means we're on the start page, with no label.
            // On this page, we just want to enqueue all the category pages.

            await page.waitForSelector('.collection-block-item');
            await enqueueLinks({
                selector: '.collection-block-item',
                label: 'CATEGORY',
            });
        }
    },
});

await crawler.run(['https://warehouse-theme-metal.myshopify.com/collections']);
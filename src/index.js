const UrlsScraper = require('./scrapers/urlsScraper');
const DetailScraper = require('./scrapers/detailScraper');
const ChaptersScraper = require('./scrapers/chaptersScraper');

async function main() {
  const mode = process.argv[2] || 'all';

  try {
    if (mode === 'urls' || mode === 'all') {
      const urlsScraper = new UrlsScraper();
      await urlsScraper.scrape();
    }

    if (mode === 'details' || mode === 'all') {
      const detailScraper = new DetailScraper();
      await detailScraper.scrape();
    }

    if (mode === 'chapters' || mode === 'all') {
      const chaptersScraper = new ChaptersScraper();
      await chaptersScraper.scrape();
    }

    console.log('Scraping completed successfully!');
  } catch (error) {
    console.error('Error during scraping:', error);
    process.exit(1);
  }
}

main();

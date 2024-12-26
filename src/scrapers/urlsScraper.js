const cheerio = require('cheerio');
const fs = require('fs-extra');
const config = require('../../config/config');
const Helpers = require('../utils/helpers');

class UrlsScraper {
  constructor() {
    this.startTime = null;
    this.totalPages = 0;
    this.processedPages = 0;
  }

  formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }

  getProgress() {
    const elapsed = Date.now() - this.startTime;
    const rate = this.processedPages / (elapsed / 1000 / 60);
    const remaining = Math.ceil((this.totalPages - this.processedPages) / rate);

    return {
      progress: `${this.processedPages}/${this.totalPages}`,
      percent: Math.round((this.processedPages / this.totalPages) * 100),
      elapsed: this.formatTime(elapsed),
      eta: this.formatTime(remaining * 60 * 1000),
      rate: rate.toFixed(2)
    };
  }

  async scrape() {
    this.startTime = Date.now();
    await Helpers.ensureDirectories();

    let { total, novels } = await Helpers.loadExistingUrls();
    const existingNovels = new Map(novels.map(n => [n.url, n]));

    const firstPageUrl = Helpers.formatUrl(0);
    const firstPageResponse = await Helpers.makeRequest(firstPageUrl);

    this.totalPages = Helpers.getLastPage(firstPageResponse.data) + 1;
    config.pagination.endPage = this.totalPages - 1;
    this.processedPages = 0;

    console.log(`\n📚 Starting URL scraping`);
    console.log(`📑 Total pages to scrape: ${this.totalPages}\n`);

    let totalUpdatedNovels = 0;
    for (let page = config.pagination.startPage; page <= config.pagination.endPage; page++) {
      try {
        const url = Helpers.formatUrl(page);
        const response = page === 0 ? firstPageResponse : await Helpers.queueRequest(url);
        const $ = cheerio.load(response.data);

        let pageUpdated = false;
        let novelsOnPage = 0;
        let novelsUpdated = 0;

        $(config.selectors.novelList.item).each((_, element) => {
          const $el = $(element);
          novelsOnPage++;

          const chaptersText = $el.find(config.selectors.novelList.totalChapters).text();
          const totalChapters = parseInt(chaptersText.match(/(\d+)/)?.[1] || '0');

          if (!totalChapters) {
            console.log(`   ⚠️ Skipping novel - Invalid chapter count`);
            return;
          }

          const novelUrl = config.baseUrl + $el.find(config.selectors.novelList.url).attr('href');
          const existingNovel = existingNovels.get(novelUrl);
          const isUpdated = !existingNovel || existingNovel.total_chapters !== totalChapters;

          const currentNovel = {
            url: novelUrl,
            total_chapters: totalChapters,
            status: $el.find(config.selectors.novelList.status).text().trim(),
            updated: isUpdated,
            id: existingNovel?.id || null
          };

          existingNovels.set(novelUrl, currentNovel);
          if (isUpdated) {
            novelsUpdated++;
            pageUpdated = true;
          }
        });

        this.processedPages++;
        const progress = this.getProgress();

        console.log(`\n📖 Page ${page}`);
        console.log(`   Found: ${novelsOnPage} novels | Updated: ${novelsUpdated}`);
        console.log(`   Progress: ${progress.percent}% | ` +
          `Page: ${page}/${config.pagination.endPage} | ` +
          `Elapsed: ${progress.elapsed} | ETA: ${progress.eta} | ` +
          `Rate: ${progress.rate} pages/min`);

        if (pageUpdated) {
          totalUpdatedNovels += novelsUpdated;
          const updatedNovelsList = Array.from(existingNovels.values());
          await fs.outputJson(config.outputPaths.urls, {
            total: updatedNovelsList.length,
            novels: updatedNovelsList
          }, { spaces: 2 });
        }

        // Memory cleanup
        response.data = null;
        $.root().empty();
        Helpers.clearMemory();

        if (page < config.pagination.endPage) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.log(`\n❌ Error on page ${page}: ${error.message}`);
        continue;
      }
    }

    const totalTime = this.formatTime(Date.now() - this.startTime);
    console.log(`\n✨ Scraping completed in ${totalTime}!`);
    console.log(`📊 Processed ${this.processedPages} pages`);
    console.log(`📚 Updated ${totalUpdatedNovels} novels\n`);
  }
}

module.exports = UrlsScraper;

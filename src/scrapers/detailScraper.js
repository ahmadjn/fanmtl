const cheerio = require('cheerio');
const fs = require('fs-extra');
const config = require('../../config/config');
const Helpers = require('../utils/helpers');

class DetailScraper {
  constructor() {
    this.logger = null;
    this.titleCase = null;
    this.urlsData = null;
    this.urlsPath = config.outputPaths.urls;
    this.startTime = null;
    this.totalNovels = 0;
    this.processedNovels = 0;
  }

  formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }

  getProgress() {
    const elapsed = Date.now() - this.startTime;
    const rate = this.processedNovels / (elapsed / 1000 / 60);
    const remaining = Math.ceil((this.totalNovels - this.processedNovels) / rate);

    return {
      progress: `${this.processedNovels}/${this.totalNovels}`,
      percent: Math.round((this.processedNovels / this.totalNovels) * 100),
      elapsed: this.formatTime(elapsed),
      eta: this.formatTime(remaining * 60 * 1000),
      rate: rate.toFixed(2)
    };
  }

  async getNovelId(url) {
    try {
      const response = await Helpers.queueRequest(url);
      const $ = cheerio.load(response.data);
      const id = $('article#novel').attr('data-novelid');
      if (!id) throw new Error('No novel ID found in page');
      return { id, $ }; // Return both ID and loaded page to avoid re-fetching
    } catch (error) {
      throw new Error(`Failed to get novel ID: ${error.message}`);
    }
  }

  async updateUrlsJson(url, id) {
    // Find and update novel in urls.json
    const novelIndex = this.urlsData.novels.findIndex(n => n.url === url);
    if (novelIndex !== -1) {
      this.urlsData.novels[novelIndex].id = id;
      await fs.outputJson(this.urlsPath, this.urlsData, { spaces: 2 });
    }
  }

  async scrape() {
    this.startTime = Date.now();
    // Initialize logger and titleCase
    this.logger = await Helpers.initializeLogger();
    const titleCaseModule = await import('title-case');
    this.titleCase = titleCaseModule.titleCase;

    await Helpers.ensureDirectories();

    this.urlsData = await fs.readJson(this.urlsPath);
    const novels = this.urlsData.novels;
    this.totalNovels = novels.length;
    this.processedNovels = 0;

    let newNovels = 0;
    let updatedNovels = 0;
    let skippedNovels = 0;

    console.log(`\n📚 Starting novel details scraping for ${this.totalNovels} novels\n`);

    for (const novel of novels) {
      try {
        // Skip if no chapters
        if (!novel.total_chapters) {
          console.log(`\n📖 Novel: ${novel.url.split('/').pop()}`);
          console.log(`   ⚠️ Skipping - No chapters available`);
          skippedNovels++;
          continue;
        }

        // Use existing ID or get from website
        let id = novel.id;
        let $page;

        if (!id) {
          try {
            const result = await this.getNovelId(novel.url);
            id = result.id;
            $page = result.$;
            await this.updateUrlsJson(novel.url, id);
          } catch (error) {
            console.log(`\n📖 Novel: ${novel.url.split('/').pop()}`);
            console.log(`   ❌ Error: ${error.message}`);
            skippedNovels++;
            continue;
          }
        }

        await Helpers.ensureNovelDirectories(id);

        // Check if novel_detail.json exists
        const novelDetailPath = config.outputPaths.novelDetail(id);
        try {
          const existingDetail = await fs.readJson(novelDetailPath);

          if (novel.updated || existingDetail.total_chapters !== novel.total_chapters) {
            console.log(`\n📖 Novel: ${novel.url.split('/').pop()}`);
            console.log(`   ⚡ Updating chapters: ${existingDetail.total_chapters} → ${novel.total_chapters}`);

            existingDetail.total_chapters = novel.total_chapters;
            await fs.outputJson(novelDetailPath, existingDetail, { spaces: 2 });
          } else {
            console.log(`\n📖 Novel: ${novel.url.split('/').pop()}`);
            console.log(`   ⏭️ Skipping - No changes needed`);
          }

          updatedNovels++;
          continue;
        } catch (error) {
          console.log(`\n📖 Novel: ${novel.url.split('/').pop()}`);
          console.log(`   🆕 New novel - Scraping details...`);
        }

        // Use already loaded page or fetch new one
        let $;
        let response;
        if ($page) {
          $ = $page;
        } else {
          response = await Helpers.queueRequest(novel.url);
          $ = cheerio.load(response.data);
        }

        // Get author with fallback
        const authorEl = $('.author span:last-child');
        const author = authorEl.length ? authorEl.text().trim() : 'Unknown';

        // Get summary with fallback
        const summaryEl = $('.summary .content');
        const summary = summaryEl.length ? summaryEl.html() : '<p>No summary available</p>';

        // Get tags and filter empty/invalid ones
        const tags = $('.tags .content li a')
          .map((_, el) => $(el).text().trim())
          .get()
          .filter(tag => tag && tag !== '' && !tag.match(/^\s*$/));

        // Get categories and filter empty ones
        const categories = $('.categories ul:first-child li a')
          .map((_, el) => $(el).text().trim())
          .get()
          .filter(category => category && category !== '');

        const details = {
          id,
          slug: this.extractSlug(novel.url),
          title: this.titleCase($('.novel-title').first().text().trim()) || 'Unknown Title',
          author,
          image_url: config.baseUrl + ($('.novel-cover img').attr('data-src') || '/static/picture/placeholder-158.jpg'),
          summary,
          categories: categories.length ? categories : ['Fantasy'],
          tags: tags.length ? tags : [],
          total_chapters: novel.total_chapters,
          scraped_chapters: 0,
          status: $('.header-stats strong:contains("Ongoing"), .header-stats strong:contains("Completed")').text().trim() || 'Unknown',
          url_source: novel.url
        };

        // Validate required fields
        if (!details.title || details.title === 'Unknown Title') {
          console.log(`   ❌ Error: No title found, skipping...`);
          continue;
        }

        await fs.outputJson(novelDetailPath, details, { spaces: 2 });
        console.log(`   ✨ Details saved successfully`);

        // Clear memory
        if (response) {
          response.data = null;
        }
        $.root().empty();
        Helpers.clearMemory();

        this.processedNovels++;
        const progress = this.getProgress();

        console.log(`   Progress: ${progress.percent}% | ` +
          `Elapsed: ${progress.elapsed} | ETA: ${progress.eta} | ` +
          `Rate: ${progress.rate} novels/min`);

        await new Promise(resolve => setTimeout(resolve, config.delays.betweenNovels()));
      } catch (error) {
        console.log(`\n📖 Novel: ${novel.url.split('/').pop()}`);
        console.log(`   ❌ Error: ${error.message}`);
        continue;
      }
    }

    const totalTime = this.formatTime(Date.now() - this.startTime);
    console.log(`\n✨ Scraping completed in ${totalTime}!`);
    console.log(`📊 Processed ${this.processedNovels}/${this.totalNovels} novels`);
    console.log(`📈 Stats:`);
    console.log(`   New: ${newNovels} | Updated: ${updatedNovels} | Skipped: ${skippedNovels}\n`);
  }

  extractSlug(url) {
    return url.split('/').pop().replace('.html', '');
  }
}

module.exports = DetailScraper;

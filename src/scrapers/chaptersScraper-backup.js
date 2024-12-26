const cheerio = require('cheerio');
const fs = require('fs-extra');
const config = require('../../config/config');
const Helpers = require('../utils/helpers');

class ChaptersScraper {
  constructor() {
    this.logger = null;
    this.titleCase = null;
    this.startTime = null;
    this.totalNovels = 0;
    this.processedNovels = 0;
    this.totalChaptersScraped = 0;
    this.failedChapters = 0;
  }

  decodeHtmlEntities(text) {
    const entities = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#039;': "'",
      '&rsquo;': "'",
      '&lsquo;': "'",
      '&ldquo;': '"',
      '&rdquo;': '"',
      '&ndash;': '–',
      '&mdash;': '—',
      '&hellip;': '...'
    };

    return text.replace(/&[^;]+;/g, match => entities[match] || match);
  }

  formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }

  getProgress() {
    const elapsed = Date.now() - this.startTime;
    const rate = this.processedNovels / (elapsed / 1000 / 60); // novels per minute
    const remaining = Math.ceil((this.totalNovels - this.processedNovels) / rate);

    return {
      progress: `${this.processedNovels}/${this.totalNovels}`,
      percent: Math.round((this.processedNovels / this.totalNovels) * 100),
      elapsed: this.formatTime(elapsed),
      eta: this.formatTime(remaining * 60 * 1000),
      rate: rate.toFixed(2)
    };
  }

  async scrape() {
    this.startTime = Date.now();
    // Initialize logger and titleCase
    this.logger = await Helpers.initializeLogger();
    const titleCaseModule = await import('title-case');
    this.titleCase = titleCaseModule.titleCase;

    await Helpers.ensureDirectories();

    const urlsData = await fs.readJson(config.outputPaths.urls);
    const novels = urlsData.novels;
    this.totalNovels = novels.length;
    this.processedNovels = 0;

    console.log(`\n📚 Starting chapter scraping for ${this.totalNovels} novels\n`);

    for (const novel of novels) {
      try {
        // Skip if no chapters
        if (!novel.total_chapters) {
          await this.logger.warn(`Skipping novel - No chapters`, {
            url: novel.url,
            total_chapters: novel.total_chapters
          });
          continue;
        }

        const novelId = await this.getNovelId(novel.url);
        if (!novelId) {
          await this.logger.error(`Could not get novel ID`, { url: novel.url });
          continue;
        }

        await this.logger.info(`Scraping chapters for novel`, {
          url: novel.url,
          total_chapters: novel.total_chapters,
          progress: `${this.processedNovels + 1}/${this.totalNovels}`
        });

        // Create chapters directory
        await Helpers.ensureNovelDirectories(novelId);

        // Load existing chapter list or create new one
        let chapterList;
        try {
          chapterList = await fs.readJson(config.outputPaths.chapterList(novelId));
        } catch (error) {
          chapterList = {
            total: novel.total_chapters,
            chapters: []
          };
        }

        // Start from last scraped chapter + 1
        const novelDetailPath = config.outputPaths.novelDetail(novelId);
        const novelDetail = await fs.readJson(novelDetailPath);
        const startChapter = (novelDetail.scraped_chapters || 0) + 1;
        const totalChapters = novel.total_chapters;

        console.log(`\n📖 Novel: ${novel.url.split('/').pop()}`);
        console.log(`   Chapters: ${startChapter - 1}/${totalChapters} scraped`);

        if (startChapter > 1) {
          console.log(`   📝 Resuming from chapter ${startChapter}`);
        }

        // Scrape each chapter
        for (let chapter = startChapter; chapter <= totalChapters; chapter++) {
          try {
            const chapterUrl = this.formatChapterUrl(novel.url, chapter);
            const response = await Helpers.queueRequest(chapterUrl);
            const $ = cheerio.load(response.data);

            // Get chapter title
            const rawTitle = $('h2').text().trim();
            const chapterTitle = this.titleCase(
              this.decodeHtmlEntities(Helpers.cleanText(rawTitle))
            );

            // Get chapter content and remove ads
            const content = $('.chapter-content').clone();
            content.find('script').remove();
            content.find('div[align="center"]').remove();
            const chapterContent = content.html();

            if (!chapterContent) {
              throw new Error('No chapter content found');
            }

            const chapterData = {
              chapter_number: chapter,
              chapter_title: chapterTitle,
              chapter_content: chapterContent
            };

            // Save chapter
            await fs.outputJson(
              config.outputPaths.chapter(novelId, chapter),
              chapterData,
              { spaces: 2 }
            );

            // Add to chapter list
            chapterList.chapters[chapter - 1] = {
              chapter_number: chapter,
              chapter_title: chapterTitle
            };

            // Update chapter list file
            await fs.outputJson(
              config.outputPaths.chapterList(novelId),
              chapterList,
              { spaces: 2 }
            );

            // Update novel detail
            novelDetail.scraped_chapters = chapter;
            await fs.outputJson(novelDetailPath, novelDetail, { spaces: 2 });

            process.stdout.write(`\r   💾 Saved: Chapter ${chapter.toString().padStart(4, ' ')}/${totalChapters} - ${chapterTitle}`);

            // Clear memory
            response.data = null;
            $.root().empty();
            Helpers.clearMemory();

            // Delay between chapters
            await new Promise(resolve => setTimeout(resolve, config.delays.betweenChapters()));

            // Update progress setiap 5 chapter
            if (chapter % 5 === 0) {
              const progress = this.getProgress();
              console.log(''); // New line after chapter progress
              process.stdout.write(`\r   Progress: ${progress.percent}% | ` +
                `Elapsed: ${progress.elapsed} | ETA: ${progress.eta} | ` +
                `Rate: ${progress.rate} novels/min`);
            }

          } catch (error) {
            console.log(`\n   ❌ Failed: Chapter ${chapter}/${totalChapters} - ${error.message}`);
            this.failedChapters++;
            continue;
          }
          this.totalChaptersScraped++;
        }

        this.processedNovels++;
        const progress = this.getProgress();
        console.log(''); // New line after last chapter
        console.log(`\n   ✅ Completed: ${novelDetail.scraped_chapters}/${totalChapters} chapters`);
        console.log(`\nOverall Progress: ${progress.progress} novels (${progress.percent}%)`);
        console.log(`Time elapsed: ${progress.elapsed} | ETA: ${progress.eta}`);
        console.log(`Rate: ${progress.rate} novels/min\n`);

      } catch (error) {
        console.log(`\n❌ Error processing novel: ${error.message}`);
        continue;
      }
    }

    const totalTime = this.formatTime(Date.now() - this.startTime);
    console.log(`\n✨ Scraping completed in ${totalTime}!`);
    console.log(`📊 Processed ${this.processedNovels}/${this.totalNovels} novels`);
    console.log(`📑 Chapters: ${this.totalChaptersScraped} scraped, ${this.failedChapters} failed\n`);
  }

  async getNovelId(url) {
    try {
      const response = await Helpers.queueRequest(url);
      const $ = cheerio.load(response.data);
      return $('article#novel').attr('data-novelid');
    } catch (error) {
      return null;
    }
  }

  formatChapterUrl(novelUrl, chapter) {
    return novelUrl.replace('.html', `_${chapter}.html`);
  }
}

module.exports = ChaptersScraper;

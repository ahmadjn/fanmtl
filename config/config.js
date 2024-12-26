module.exports = {
  baseUrl: 'https://www.fanmtl.com',
  pagination: {
    startPage: 0,
    endPage: 0
  },
  selectors: {
    novelList: {
      container: '.novel-list',
      item: '.novel-item',
      url: 'a',
      totalChapters: '.novel-stats span:has(i.material-icons:contains("book"))',
      status: '.novel-stats:last-child .status'
    },
    novelDetail: {
      novelId: 'article#novel[data-novelid]',
      title: 'h1.novel-title',
      author: '.author span:last-child',
      image: '.novel-cover img[data-src]',
      summary: '.summary .content:not(:has(script))',
      categories: '.categories ul:first-child li a',
      tags: '.tags .content li a'
    },
    chapterContent: {
      title: '.chapter-title',
      content: '.chapter-content',
      ads: {
        scripts: 'script',
        banners: 'div[align="center"]'
      }
    }
  },
  outputPaths: {
    urls: './data/urls.json',
    novelDetail: (id) => `./data/novels/${id}/novel_detail.json`,
    chapterList: (id) => `./data/novels/${id}/chapter_list.json`,
    chapter: (id, number) => `./data/novels/${id}/chapters/chapter_${number}.json`
  },
  delays: {
    betweenPages: () => Math.floor(Math.random() * (500 - 50 + 1)) + 50,
    betweenNovels: () => Math.floor(Math.random() * (500 - 50 + 1)) + 50,
    betweenChapters: () => Math.floor(Math.random() * (500 - 50 + 1)) + 50
  }
}

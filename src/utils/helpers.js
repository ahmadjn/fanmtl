const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const config = require('../../config/config');

class Helpers {
  static mobileUserAgents = [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 10; SM-A205U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.50 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.50 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/95.0.4638.50 Mobile/15E148 Safari/604.1'
  ];

  static requestQueue = [];
  static isProcessing = false;
  static rateLimit = 2; // requests per second
  static lastRequestTime = 0;

  static getRandomUserAgent() {
    return this.mobileUserAgents[Math.floor(Math.random() * this.mobileUserAgents.length)];
  }

  static async retryRequest(fn, retries = 3, delay = 2000) {
    try {
      return await fn();
    } catch (error) {
      if (retries === 0) throw error;

      let nextDelay = delay;
      if (error.response) {
        // Handle specific HTTP errors
        switch (error.response.status) {
          case 429: // Too Many Requests
            nextDelay = delay * 2;
            console.log('Rate limited, waiting longer...');
            break;
          case 503: // Service Unavailable
            nextDelay = delay * 1.5;
            console.log('Service unavailable, retrying...');
            break;
          default:
            console.log(`Request failed with status ${error.response.status}`);
        }
      }

      console.log(`Retrying in ${nextDelay / 1000} seconds... (${retries} attempts left)`);
      await new Promise(resolve => setTimeout(resolve, nextDelay));
      return this.retryRequest(fn, retries - 1, nextDelay * 1.5);
    }
  }

  static async queueRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ url, options, resolve, reject });
      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  static async processQueue() {
    if (this.requestQueue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const { url, options, resolve, reject } = this.requestQueue.shift();

    try {
      // Ensure minimum time between requests
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      const minRequestInterval = 1000 / this.rateLimit;

      if (timeSinceLastRequest < minRequestInterval) {
        await new Promise(resolve =>
          setTimeout(resolve, minRequestInterval - timeSinceLastRequest)
        );
      }

      const response = await this.makeRequest(url, options);
      this.lastRequestTime = Date.now();
      resolve(response);
    } catch (error) {
      reject(error);
    }

    // Process next request
    setTimeout(() => this.processQueue(), 1000 / this.rateLimit);
  }

  static async makeRequest(url, options = {}) {
    const config = {
      headers: {
        'User-Agent': this.getRandomUserAgent(),
        'Connection': 'keep-alive',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        ...options.headers
      },
      timeout: 10000,
      httpAgent: new (require('http').Agent)({
        keepAlive: true,
        maxSockets: 100,
        maxFreeSockets: 10,
        timeout: 60000
      }),
      httpsAgent: new (require('https').Agent)({
        keepAlive: true,
        maxSockets: 100,
        maxFreeSockets: 10,
        timeout: 60000
      }),
      decompress: true,
      maxRedirects: 5,
      ...options
    };

    return this.retryRequest(() => axios(url, config));
  }

  static async ensureDirectories() {
    await fs.ensureDir('./data');
    console.log('Data directory is ready');
  }

  static async ensureNovelDirectories(novelId) {
    const novelDir = path.join('./data', 'novels', novelId);
    const chaptersDir = path.join(novelDir, 'chapters');

    await fs.ensureDir(novelDir);
    await fs.ensureDir(chaptersDir);
    console.log(`Directories for novel ${novelId} are ready`);
  }

  static getLastPage(html) {
    const match = html.match(/\/list\/all\/all-newstime-(\d+)\.html">[^<]*<\/a><\/li>\s*<\/ul>/);
    return match ? parseInt(match[1]) : 0;
  }

  static formatUrl(page) {
    return `${config.baseUrl}/list/all/all-newstime-${page}.html`;
  }

  // Memory optimization helpers
  static clearMemory() {
    if (global.gc) {
      global.gc();
    }
  }

  static async loadExistingUrls() {
    try {
      const data = await fs.readJson(config.outputPaths.urls);
      return {
        total: data.total || 0,
        novels: data.novels || []
      };
    } catch (error) {
      return { total: 0, novels: [] };
    }
  }

  static compareNovelData(existing, current) {
    if (!existing) return { ...current, updated: true };

    const isUpdated = existing.total_chapters !== current.total_chapters;
    return {
      ...current,
      updated: isUpdated
    };
  }

  static cleanText(text) {
    return text
      // Replace multiple newlines/spaces with single space
      .replace(/\s+/g, ' ')
      // Remove spaces around newlines
      .replace(/\s*\n\s*/g, '\n')
      // Replace multiple newlines with single newline
      .replace(/\n+/g, '\n')
      // Trim spaces at start and end
      .trim();
  }

  static async initializeLogger() {
    const logDir = './logs';
    const date = new Date().toISOString().split('T')[0];
    await fs.ensureDir(logDir);

    return {
      error: async (message, context = {}) => {
        const logEntry = {
          timestamp: new Date().toISOString(),
          level: 'ERROR',
          message,
          context
        };
        await fs.appendFile(
          path.join(logDir, `error_${date}.log`),
          JSON.stringify(logEntry) + '\n'
        );
        console.error(`ERROR: ${message}`);
      },
      warn: async (message, context = {}) => {
        const logEntry = {
          timestamp: new Date().toISOString(),
          level: 'WARN',
          message,
          context
        };
        await fs.appendFile(
          path.join(logDir, `warn_${date}.log`),
          JSON.stringify(logEntry) + '\n'
        );
        console.warn(`WARN: ${message}`);
      },
      info: async (message, context = {}) => {
        const logEntry = {
          timestamp: new Date().toISOString(),
          level: 'INFO',
          message,
          context
        };
        await fs.appendFile(
          path.join(logDir, `info_${date}.log`),
          JSON.stringify(logEntry) + '\n'
        );
        console.log(`INFO: ${message}`);
      }
    };
  }
}

module.exports = Helpers;

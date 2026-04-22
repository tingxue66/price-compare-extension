/**
 * Chrome Storage 封装
 */

const StorageUtil = {
  getDefaultSettings() {
    return {
      autoExtract: true,
      notifyPriceDrop: false,
      autoRefreshEnabled: false,
      autoRefreshIntervalMinutes: 60,
      lastAutoRefreshAt: null,
      lastAutoRefreshReason: '',
      lastAutoRefreshCount: 0,
      lastAutoRefreshTotal: 0
    };
  },

  normalizePlatformKey(platform) {
    return platform === 'tmall' ? 'taobao' : platform;
  },

  createPlatformSnapshot(productInfo, existing = null) {
    const store = productInfo.store || existing?.store || '';
    return {
      platform: productInfo.platform || existing?.platform || '',
      price: productInfo.price ?? null,
      originalPrice: productInfo.originalPrice ?? existing?.originalPrice ?? null,
      url: productInfo.url || existing?.url || '',
      productId: productInfo.productId || existing?.productId || '',
      title: productInfo.title || existing?.title || '',
      store,
      image: productInfo.image || existing?.image || '',
      official: PlatformUtil.isOfficialStore(store),
      boundAt: existing?.boundAt || Date.now(),
      lastChecked: Date.now()
    };
  },

  getWatchlistHistoryKey(itemId) {
    return `watchlist:${itemId}`;
  },

  normalizeHistoryTitle(title) {
    return (title || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  },

  getSnapshotSourcePlatform(snapshot, fallbackPlatform) {
    return snapshot?.platform ||
      PlatformUtil.detectPlatform(snapshot?.url) ||
      fallbackPlatform;
  },

  async appendHistoryRecord(historyKey, meta, record) {
    const storageKey = `history:${historyKey}`;
    const history = (await this.get(storageKey)) || {
      title: meta.title,
      image: meta.image || '',
      type: meta.type || 'standalone',
      itemId: meta.itemId || null,
      keyword: meta.keyword || '',
      records: []
    };

    const lastRecord = history.records[history.records.length - 1];
    const duplicateWindowMs = 30 * 60 * 1000;
    const isDuplicate = !!lastRecord &&
      lastRecord.platform === record.platform &&
      lastRecord.price === record.price &&
      lastRecord.originalPrice === record.originalPrice &&
      lastRecord.store === record.store &&
      lastRecord.url === record.url &&
      lastRecord.productId === record.productId &&
      (Date.parse(record.date) - Date.parse(lastRecord.date)) < duplicateWindowMs;

    if (!isDuplicate) {
      history.records.push(record);
    }

    if (history.records.length > 500) {
      history.records = history.records.slice(-500);
    }

    history.title = meta.title || history.title;
    history.image = meta.image || history.image || '';
    history.type = meta.type || history.type || 'standalone';
    history.itemId = meta.itemId || history.itemId || null;
    history.keyword = meta.keyword || history.keyword || '';
    await this.set(storageKey, history);
    return history;
  },

  async recordWatchlistSnapshot(item, platformKey) {
    const snapshot = item?.[platformKey];
    if (!snapshot || snapshot.price === null || snapshot.price === undefined) return null;

    const record = {
      platform: this.getSnapshotSourcePlatform(snapshot, platformKey),
      price: snapshot.price,
      originalPrice: snapshot.originalPrice ?? null,
      store: snapshot.store || '',
      date: new Date().toISOString(),
      url: snapshot.url || '',
      productId: snapshot.productId || '',
      watchlistItemId: item.id
    };

    return await this.appendHistoryRecord(
      this.getWatchlistHistoryKey(item.id),
      {
        title: item.title,
        image: item.image || snapshot.image || '',
        type: 'watchlist',
        itemId: item.id,
        keyword: item.keyword || ''
      },
      record
    );
  },

  async recordWatchlistHistory(item) {
    for (const key of ['jd', 'taobao']) {
      await this.recordWatchlistSnapshot(item, key);
    }
  },

  async ensureWatchlistHistories() {
    const list = await this.getWatchlist();
    for (const item of list) {
      await this.recordWatchlistHistory(item);
    }
  },

  /**
   * 读取数据
   */
  async get(key) {
    const result = await chrome.storage.local.get(key);
    return typeof key === 'string' ? result[key] : result;
  },

  /**
   * 写入数据
   */
  async set(key, value) {
    if (typeof key === 'object') {
      await chrome.storage.local.set(key);
    } else {
      await chrome.storage.local.set({ [key]: value });
    }
  },

  /**
   * 删除数据
   */
  async remove(key) {
    await chrome.storage.local.remove(key);
  },

  // ========== 关注清单操作 ==========

  /**
   * 获取关注清单
   */
  async getWatchlist() {
    const list = (await this.get('watchlist')) || [];
    let changed = false;

    for (const item of list) {
      for (const key of ['jd', 'taobao']) {
        const snapshot = item[key];
        if (!snapshot) continue;

        const detectedPlatform = snapshot.platform || PlatformUtil.detectPlatform(snapshot.url);
        if (detectedPlatform && snapshot.platform !== detectedPlatform) {
          snapshot.platform = detectedPlatform;
          changed = true;
        }
      }
    }

    if (changed) {
      await this.set('watchlist', list);
    }

    return list;
  },

  /**
   * 添加商品到关注清单
   */
  async addToWatchlist(item) {
    const list = await this.getWatchlist();
    const platformKey = this.normalizePlatformKey(item.platform);
    const entry = {
      id: 'w_' + Date.now().toString(36),
      keyword: item.keyword || item.title,
      title: item.title,
      image: item.image || '',
      store: item.store || '',
      official: PlatformUtil.isOfficialStore(item.store || ''),
      jd: null,
      taobao: null,
      addedAt: Date.now(),
      updatedAt: Date.now()
    };

    if (platformKey === 'jd' || platformKey === 'taobao') {
      entry[platformKey] = this.createPlatformSnapshot(item);
    }

    list.unshift(entry);
    await this.set('watchlist', list);
    await this.recordWatchlistHistory(entry);
    return entry;
  },

  /**
   * 更新关注清单中的商品价格
   */
  async updateWatchlistItem(itemId, platform, priceData) {
    const list = await this.getWatchlist();
    const item = list.find(i => i.id === itemId);
    if (!item) return null;

    const key = this.normalizePlatformKey(platform);
    item[key] = {
      ...(item[key] || {}),
      price: priceData.price,
      originalPrice: priceData.originalPrice ?? item[key]?.originalPrice ?? null,
      platform: priceData.platform || item[key]?.platform || platform,
      url: priceData.url || item[key]?.url || '',
      productId: priceData.productId || item[key]?.productId || '',
      lastChecked: Date.now()
    };
    item.updatedAt = Date.now();
    await this.set('watchlist', list);
    await this.recordWatchlistSnapshot(item, key);
    return item;
  },

  /**
   * 将当前商品页绑定到清单项的对应平台
   */
  async bindProductToWatchlist(itemId, productInfo) {
    const list = await this.getWatchlist();
    const item = list.find(i => i.id === itemId);
    if (!item) return null;

    const key = this.normalizePlatformKey(productInfo.platform);
    if (key !== 'jd' && key !== 'taobao') return null;

    item[key] = this.createPlatformSnapshot(productInfo, item[key]);
    item.image = item.image || productInfo.image || item[key].image || '';
    item.store = item.store || productInfo.store || '';
    item.official = item.official || item[key].official;
    item.keyword = item.keyword || PlatformUtil.extractKeywords(productInfo.title);

    const hasRealTitle = item.title && item.title !== item.keyword;
    if (!hasRealTitle || !item.title) {
      item.title = productInfo.title;
    }

    item.updatedAt = Date.now();
    await this.set('watchlist', list);
    await this.recordWatchlistHistory(item);
    return item;
  },

  /**
   * 已绑定页面再次被访问时，自动同步该平台价格
   */
  async syncWatchlistByProduct(productInfo) {
    const key = this.normalizePlatformKey(productInfo.platform);
    if (key !== 'jd' && key !== 'taobao') return [];

    const list = await this.getWatchlist();
    const updatedItems = [];

    for (const item of list) {
      const existing = item[key];
      if (!existing) continue;

      const sameProductId = existing.productId && productInfo.productId &&
        existing.productId === productInfo.productId;
      const sameUrl = existing.url && productInfo.url && existing.url === productInfo.url;

      if (!sameProductId && !sameUrl) continue;

      item[key] = this.createPlatformSnapshot(productInfo, existing);
      item.image = item.image || productInfo.image || existing.image || '';
      item.store = item.store || productInfo.store || existing.store || '';
      item.official = item.official || item[key].official;
      item.updatedAt = Date.now();
      updatedItems.push(item);
    }

    if (updatedItems.length > 0) {
      await this.set('watchlist', list);
      for (const item of updatedItems) {
        await this.recordWatchlistSnapshot(item, key);
      }
    }

    return updatedItems;
  },

  async findWatchlistItemByProduct(productInfo) {
    const key = this.normalizePlatformKey(productInfo.platform);
    if (key !== 'jd' && key !== 'taobao') return null;

    const list = await this.getWatchlist();
    for (const item of list) {
      const snapshot = item[key];
      if (!snapshot) continue;

      const sameProductId = snapshot.productId && productInfo.productId &&
        snapshot.productId === productInfo.productId;
      const sameUrl = snapshot.url && productInfo.url && snapshot.url === productInfo.url;

      if (sameProductId || sameUrl) {
        return item;
      }
    }

    return null;
  },

  async getHistoryForProduct(productInfo) {
    await this.ensureWatchlistHistories();

    const watchlistItem = await this.findWatchlistItemByProduct(productInfo);
    if (watchlistItem) {
      return await this.get(`history:${this.getWatchlistHistoryKey(watchlistItem.id)}`);
    }

    return await this.get(`history:${productInfo.productKey}`);
  },

  /**
   * 从关注清单移除
   */
  async removeFromWatchlist(itemId) {
    const list = await this.getWatchlist();
    const filtered = list.filter(i => i.id !== itemId);
    await this.set('watchlist', filtered);
  },

  // ========== 价格历史操作 ==========

  /**
   * 记录价格
   */
  async recordPrice(productInfo) {
    const nextRecord = {
      platform: productInfo.platform,
      price: productInfo.price,
      originalPrice: productInfo.originalPrice,
      store: productInfo.store || '',
      date: new Date().toISOString(),
      url: productInfo.url,
      productId: productInfo.productId || ''
    };
    await this.appendHistoryRecord(
      productInfo.productKey || productInfo.productId,
      {
        title: productInfo.title,
        image: productInfo.image || '',
        type: 'standalone',
        keyword: PlatformUtil.extractKeywords(productInfo.title)
      },
      nextRecord
    );
  },

  /**
   * 获取某商品的价格历史
   */
  async getHistory(productKey) {
    return await this.get(`history:${productKey}`);
  },

  /**
   * 获取所有有历史记录的商品列表
   */
  async getAllHistoryKeys() {
    await this.ensureWatchlistHistories();

    const all = await chrome.storage.local.get(null);
    const items = Object.keys(all)
      .filter(k => k.startsWith('history:'))
      .map(k => ({
        key: k.replace('history:', ''),
        title: all[k].title,
        type: all[k].type || 'standalone',
        itemId: all[k].itemId || null,
        keyword: all[k].keyword || '',
        recordCount: all[k].records.length,
        lastRecord: all[k].records[all[k].records.length - 1]
      }));

    const watchlistKeywordSet = new Set(
      items
        .filter(item => item.type === 'watchlist')
        .map(item => this.normalizeHistoryTitle(item.keyword || item.title))
        .filter(Boolean)
    );

    return items.filter(item => {
      if (item.type === 'watchlist') return true;
      const normalized = this.normalizeHistoryTitle(item.keyword || item.title);
      return !watchlistKeywordSet.has(normalized);
    });
  },

  // ========== 设置操作 ==========

  async getSettings() {
    const settings = (await this.get('settings')) || {};
    return {
      ...this.getDefaultSettings(),
      ...settings
    };
  },

  async updateSettings(partial) {
    const settings = await this.getSettings();
    Object.assign(settings, partial);
    await this.set('settings', settings);
    return settings;
  }
};

if (typeof module !== 'undefined') {
  module.exports = StorageUtil;
}

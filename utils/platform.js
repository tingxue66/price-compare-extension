/**
 * 平台识别与搜索工具
 */

const PlatformUtil = {
  /**
   * 根据 URL 识别电商平台
   */
  detectPlatform(url) {
    if (!url) return null;
    if (/\.jd\.com/.test(url)) return 'jd';
    if (/\.tmall\.com/.test(url)) return 'tmall';
    if (/\.taobao\.com/.test(url)) return 'taobao';
    return null;
  },

  /**
   * 判断是否为商品详情页
   */
  isProductPage(url) {
    if (!url) return false;
    if (/item\.jd\.com\/\d+/.test(url)) return true;
    if (/product\.jd\.com\/\d+/.test(url)) return true;
    if (/item\.taobao\.com\/item\.htm/.test(url)) return true;
    if (/detail\.tmall\.com\/item\.htm/.test(url)) return true;
    if (/chaoshi\.detail\.tmall\.com/.test(url)) return true;
    return false;
  },

  /**
   * 从 URL 中提取商品 ID
   */
  extractProductId(url) {
    if (!url) return null;
    let match = url.match(/(?:item|product)\.jd\.com\/(\d+)/);
    if (match) return match[1];
    match = url.match(/[?&]id=(\d+)/);
    if (match) return match[1];
    return null;
  },

  /**
   * 构造跨平台商品搜索 URL（普通搜商品）
   */
  buildSearchUrl(targetPlatform, keyword) {
    const encoded = encodeURIComponent(keyword);
    switch (targetPlatform) {
      case 'jd':
        return `https://search.jd.com/Search?keyword=${encoded}&enc=utf-8`;
      case 'taobao':
        return `https://s.taobao.com/search?q=${encoded}`;
      case 'tmall':
        return `https://list.tmall.com/search_product.htm?q=${encoded}`;
      default:
        return null;
    }
  },

  /**
   * 构造「进入对方平台旗舰店并店内搜商品」的 URL
   *
   * 策略：
   *   天猫旗舰店 URL 通常是 {brand}.tmall.com
   *   京东旗舰店 URL 通常是 {brand}.jd.com
   *   在店铺内搜索：{brand}.tmall.com/search.htm?q=关键词
   *
   * 返回一个数组，包含多个链接（优先级从高到低），由调用方决定打开几个
   */
  buildStoreSearchUrls(targetPlatform, productKeyword, storeName) {
    const brand = this.extractBrand(storeName);
    const brandLower = brand.toLowerCase().replace(/\s+/g, '');
    const encoded = encodeURIComponent(productKeyword);
    const urls = [];

    if (!brand) {
      // 没有品牌名，退回普通搜索
      return [{ label: '搜索商品', url: this.buildSearchUrl(targetPlatform, productKeyword) }];
    }

    if (targetPlatform === 'tmall' || targetPlatform === 'taobao') {
      // 方案1：直接进品牌天猫旗舰店 + 店内搜索
      urls.push({
        label: `${brand}天猫旗舰店内搜索`,
        url: `https://${brandLower}.tmall.com/search.htm?q=${encoded}`
      });
      // 方案2：天猫全站搜 "品牌名 + 商品关键词"
      urls.push({
        label: `天猫搜「${brand} ${productKeyword}」`,
        url: `https://list.tmall.com/search_product.htm?q=${encodeURIComponent(brand + ' ' + productKeyword)}&type=p`
      });
      // 方案3：淘宝搜店铺名
      urls.push({
        label: `淘宝搜「${brand}官方旗舰店」`,
        url: `https://s.taobao.com/search?q=${encodeURIComponent(brand + '官方旗舰店')}&tab=shop`
      });
    }

    if (targetPlatform === 'jd') {
      // 方案1：直接进品牌京东旗舰店 + 店内搜索
      urls.push({
        label: `${brand}京东旗舰店内搜索`,
        url: `https://${brandLower}.jd.com/search?keyword=${encoded}`
      });
      // 方案2：京东全站搜 "品牌名 + 商品关键词"
      urls.push({
        label: `京东搜「${brand} ${productKeyword}」`,
        url: `https://search.jd.com/Search?keyword=${encodeURIComponent(brand + ' ' + productKeyword)}&enc=utf-8`
      });
      // 方案3：京东搜旗舰店
      urls.push({
        label: `京东搜「${brand}官方旗舰店」`,
        url: `https://search.jd.com/Search?keyword=${encodeURIComponent(brand + '官方旗舰店')}&enc=utf-8`
      });
    }

    return urls;
  },

  /**
   * 从店铺名中提取品牌名
   * "vivo官方旗舰店" → "vivo"
   * "华为京东自营旗舰店" → "华为"
   * "Apple Store 官方旗舰店" → "Apple"
   * "HUAWEI华为官方旗舰店" → "HUAWEI华为"  →  取第一个词 "HUAWEI"
   */
  extractBrand(storeName) {
    if (!storeName) return '';
    let brand = storeName
      .replace(/(?:京东自营|官方|旗舰店|自营|专卖店|专营店|官方店|直营店|体验店|品牌店|海外|国际)/g, '')
      .replace(/\s*Store\s*/i, '')
      .trim();
    return brand || '';
  },

  /**
   * 判断是否为官方/旗舰店
   */
  isOfficialStore(storeName) {
    if (!storeName) return false;
    return /旗舰店|官方店|自营|直营|Official/i.test(storeName);
  },

  /**
   * 获取平台显示名称
   */
  getPlatformName(platform) {
    const names = { jd: '京东', taobao: '淘宝', tmall: '天猫' };
    return names[platform] || platform;
  },

  /**
   * 获取对方平台（用于比价跳转）
   */
  getOtherPlatforms(currentPlatform) {
    const all = ['jd', 'taobao', 'tmall'];
    return all.filter(p => p !== currentPlatform);
  },

  /**
   * 从商品标题中提取关键词（去噪）
   */
  extractKeywords(title) {
    if (!title) return '';
    let cleaned = title
      .replace(/【[^】]*】/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/(?:官方旗舰店|旗舰店|官方|自营|正品|新品|现货|预售|包邮|秒杀|限时|特价|优惠|赠品|买一送一|下单立减|领券)/g, '')
      .replace(/[（(][^）)]*[）)]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleaned.length < 4) cleaned = title.substring(0, 30);
    if (cleaned.length > 40) cleaned = cleaned.substring(0, 40);
    return cleaned;
  },

  /**
   * 生成商品唯一键
   */
  generateProductKey(title) {
    const keywords = this.extractKeywords(title).toLowerCase();
    let hash = 0;
    for (let i = 0; i < keywords.length; i++) {
      const char = keywords.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return 'pk_' + Math.abs(hash).toString(36);
  }
};

if (typeof module !== 'undefined') {
  module.exports = PlatformUtil;
}

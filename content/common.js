/**
 * Content Script 共享工具
 * 在 jd.js / taobao.js 之前注入
 */

const ContentCommon = {
  /**
   * 尝试多个选择器，返回第一个匹配的元素
   */
  queryFirst(selectors) {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  },

  /**
   * 从元素中提取文本内容
   */
  getText(selectors) {
    const el = this.queryFirst(selectors);
    return el ? el.textContent.trim() : '';
  },

  /**
   * 从文本中解析价格数字
   */
  parsePrice(text) {
    if (!text) return null;
    // 匹配价格数字，如 ¥299.00, 299, 2,999.00
    const match = text.replace(/,/g, '').match(/(\d+\.?\d*)/);
    return match ? parseFloat(match[1]) : null;
  },

  /**
   * 从元素列表中提取价格
   */
  getPrice(selectors) {
    const el = this.queryFirst(selectors);
    if (!el) return null;
    return this.parsePrice(el.textContent);
  },

  /**
   * 获取图片 src
   */
  getImage(selectors) {
    const el = this.queryFirst(selectors);
    if (!el) return '';
    return el.src || el.getAttribute('data-src') || el.getAttribute('data-lazy-img') || '';
  },

  /**
   * 发送提取的数据到 background
   */
  sendProductData(data) {
    if (!data || !data.title) return;
    chrome.runtime.sendMessage({
      type: 'PRODUCT_EXTRACTED',
      data: data
    });
  },

  /**
   * 诊断当前页面结构 — 用于调试选择器
   */
  diagnose() {
    const info = {
      url: location.href,
      title: document.title,
      // 收集页面中可能是价格的元素
      priceCandidates: [],
      // 收集页面关键区域的 class 名
      keyClasses: []
    };

    // 找所有可能包含价格的元素
    const priceRegex = /[¥￥]\s*\d+|^\d{1,7}\.?\d{0,2}$/;
    document.querySelectorAll('span, em, strong, b, div, p').forEach(el => {
      const text = el.textContent.trim();
      if (text.length < 30 && priceRegex.test(text)) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          info.priceCandidates.push({
            tag: el.tagName,
            class: el.className.toString().substring(0, 100),
            text: text.substring(0, 50),
            fontSize: window.getComputedStyle(el).fontSize,
            color: window.getComputedStyle(el).color
          });
        }
      }
    });

    // 收集页面主要容器的 class
    document.querySelectorAll('[class]').forEach(el => {
      const cls = el.className.toString();
      if (/price|title|name|shop|store|sku|item|product|gallery|img/i.test(cls)) {
        info.keyClasses.push({
          tag: el.tagName,
          class: cls.substring(0, 120),
          text: el.textContent.trim().substring(0, 60)
        });
      }
    });

    // 去重并限制数量
    info.keyClasses = info.keyClasses.slice(0, 50);
    info.priceCandidates = info.priceCandidates.slice(0, 20);

    return info;
  },

  /**
   * 使用 MutationObserver 等待元素出现后执行回调
   */
  waitForElement(selectors, callback, timeout = 10000) {
    // 先检查是否已经存在
    const existing = this.queryFirst(selectors);
    if (existing) {
      callback();
      return;
    }

    const observer = new MutationObserver((mutations, obs) => {
      const el = this.queryFirst(selectors);
      if (el) {
        obs.disconnect();
        callback();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // 超时自动断开
    setTimeout(() => {
      observer.disconnect();
      // 超时后再尝试一次
      const el = this.queryFirst(selectors);
      if (el) callback();
    }, timeout);
  },

  /**
   * 监听页面 URL 变化（SPA 场景）
   */
  onUrlChange(callback) {
    let lastUrl = location.href;
    const observer = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        callback(lastUrl);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
};

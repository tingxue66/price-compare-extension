/**
 * 京东商品页内容脚本
 * 提取商品信息并发送到 background
 */

(function () {
  const JDExtractor = {
    /**
     * 提取商品ID
     */
    extractId() {
      // URL 格式: item.jd.com/100084256753.html 或 product.jd.com/xxx
      let match = location.href.match(/(?:item|product)\.jd\.com\/(\d+)/);
      if (match) return match[1];
      // 兜底：URL 参数中的 sku/id
      match = location.href.match(/[?&](?:sku|id|wareId)=(\d+)/);
      return match ? match[1] : null;
    },

    /**
     * 提取标题 — 多重降级策略
     */
    extractTitle() {
      // 策略1：常见选择器
      const selectors = [
        '.sku-name',
        '.itemInfo-wrap .sku-name',
        '.product-intro .sku-name',
        'div.item-name',
        '.mp-wrap .mp-name',
        // 新版京东可能用的选择器
        '[class*="SkuName"]',
        '[class*="skuName"]',
        '[class*="itemName"]',
        '[class*="product-name"]',
        '[class*="ProductName"]',
        'h1[class*="name"]',
        '.goods-name',
        '.product-name'
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim().length > 2) {
          return el.textContent.trim();
        }
      }

      // 策略2：从 document.title 提取（去掉尾部的京东标识）
      const docTitle = document.title || '';
      const cleaned = docTitle
        .replace(/[-–—\s]*(京东|JD\.COM|jd\.com).*$/i, '')
        .trim();
      if (cleaned.length > 2) return cleaned;

      // 策略3：从 meta 标签提取
      const metaDesc = document.querySelector('meta[name="description"]');
      if (metaDesc) {
        const content = metaDesc.getAttribute('content') || '';
        if (content.length > 2) return content.substring(0, 100);
      }

      return '';
    },

    /**
     * 提取价格 — 多重降级策略
     */
    extractPrice() {
      // 策略1：精确选择器
      const selectors = [
        '.p-price .price',
        '.summary-price .price',
        '.price-box .p-price .price',
        '.jPrice .price',
        '.dd-price .price',
        'span.price',
        // 新版京东
        '[class*="Price"] [class*="price"]',
        '[class*="price-"] span',
        '[class*="Price--"]',
        '[class*="currentPrice"]',
        '[class*="promoPrice"]',
        '[class*="priceInfo"] span',
        '.J-p-price',
        '#jd-price',
        '.item-price'
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const price = ContentCommon.parsePrice(el.textContent);
          if (price && price > 0 && price < 9999999) return price;
        }
      }

      // 策略2：搜索页面中所有包含 ¥ 的元素
      const allElements = document.querySelectorAll('span, em, strong, b, i, div');
      for (const el of allElements) {
        const text = el.textContent.trim();
        // 匹配 ¥xx.xx 格式，且元素文本不太长（排除正文段落）
        if (text.length < 20 && /^[¥￥]?\s*\d+\.?\d{0,2}$/.test(text)) {
          const price = ContentCommon.parsePrice(text);
          if (price && price > 0.01 && price < 9999999) {
            // 检查元素样式看起来像价格（字号较大、颜色为红色等）
            const style = window.getComputedStyle(el);
            const fontSize = parseFloat(style.fontSize);
            const color = style.color;
            const isReddish = /rgb\(\s*2[0-5]\d/.test(color) || /rgb\(\s*1[5-9]\d/.test(color);
            if (fontSize >= 16 || isReddish) {
              return price;
            }
          }
        }
      }

      // 策略3：在所有文本中用正则匹配价格
      const body = document.body.innerText;
      const priceMatch = body.match(/[¥￥]\s*(\d+\.?\d{0,2})/);
      if (priceMatch) {
        const p = parseFloat(priceMatch[1]);
        if (p > 0) return p;
      }

      return null;
    },

    /**
     * 提取原价
     */
    extractOriginalPrice() {
      const selectors = [
        '.p-price del',
        '.summary-price del',
        '.price-box .p-o-price',
        '.dd-price del',
        '[class*="originPrice"]',
        '[class*="OriginalPrice"]',
        '[class*="lineThrough"]',
        '[class*="price"] del',
        '[class*="price"] s'
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const price = ContentCommon.parsePrice(el.textContent);
          if (price && price > 0) return price;
        }
      }
      return null;
    },

    /**
     * 提取店铺名
     */
    extractStore() {
      const selectors = [
        '.shopName a',
        '.shop-name',
        '.name a[clstag]',
        '.J-hove-wrap .name a',
        '#popbox .name a',
        '[class*="shopName"]',
        '[class*="ShopName"]',
        '[class*="shop-name"]',
        '[class*="StoreName"]',
        'a[href*="mall.jd.com"]',
        '.seller-info a',
        '.shop-info a'
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) {
          return el.textContent.trim();
        }
      }
      return '';
    },

    /**
     * 提取商品主图
     */
    extractImage() {
      const selectors = [
        '#spec-img',
        '#main-img',
        '.main-img img',
        '.product-img img',
        '#spec-n1 img',
        '[class*="PicGallery"] img',
        '[class*="picGallery"] img',
        '[class*="mainPic"] img',
        '.jqzoom img',
        'img[data-origin]'
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const src = el.src || el.getAttribute('data-src') ||
            el.getAttribute('data-origin') || el.getAttribute('data-lazy-img') || '';
          if (src) return src.startsWith('//') ? 'https:' + src : src;
        }
      }
      // 兜底：找页面第一张较大的图片
      const imgs = document.querySelectorAll('img');
      for (const img of imgs) {
        if (img.naturalWidth >= 200 && img.naturalHeight >= 200) {
          return img.src;
        }
      }
      return '';
    },

    /**
     * 提取完整商品信息
     */
    extract() {
      const productId = this.extractId();
      if (!productId) {
        console.log('[比价助手] 未识别到商品ID, URL:', location.href);
        return null;
      }

      const title = this.extractTitle();
      const price = this.extractPrice();
      const originalPrice = this.extractOriginalPrice();
      const store = this.extractStore();
      const image = this.extractImage();

      console.log('[比价助手] 京东提取结果:', { productId, title, price, store });

      if (!title) {
        console.log('[比价助手] 标题提取失败');
        return null;
      }

      return {
        platform: 'jd',
        productId,
        title,
        price,
        originalPrice,
        store,
        url: location.href,
        image,
        extractedAt: Date.now()
      };
    },

    /**
     * 执行提取并发送
     */
    run() {
      const data = this.extract();
      if (data) {
        ContentCommon.sendProductData(data);
      }
    },

    /**
     * 初始化
     */
    init() {
      console.log('[比价助手] 京东脚本已注入, URL:', location.href);

      // 放宽匹配：只要在 jd.com 且 URL 含数字 ID 就尝试提取
      const isProductPage = /(?:item|product)\.jd\.com\/\d+/.test(location.href) ||
        /jd\.com.*[?&](?:sku|id|wareId)=\d+/.test(location.href);

      if (!isProductPage) {
        console.log('[比价助手] 非商品详情页，跳过');
        return;
      }

      // 延迟提取 — 京东价格通常异步加载
      const tryExtract = (attempt = 1) => {
        const data = this.extract();
        if (data && data.price !== null) {
          ContentCommon.sendProductData(data);
        } else if (attempt < 5) {
          // 价格可能还没加载，重试（间隔递增）
          console.log(`[比价助手] 第${attempt}次提取未获得价格，${attempt}秒后重试...`);
          setTimeout(() => tryExtract(attempt + 1), attempt * 1000);
        } else {
          // 5次后放弃等价格，先发送已有数据
          console.log('[比价助手] 重试完毕，发送当前数据（价格可能为空）');
          if (data) ContentCommon.sendProductData(data);
        }
      };

      // 首次延迟 1.5 秒等待页面基本渲染
      setTimeout(() => tryExtract(), 1500);

      // 监听 URL 变化（SPA）
      ContentCommon.onUrlChange((url) => {
        if (/jd\.com.*\d+/.test(url)) {
          setTimeout(() => tryExtract(), 2000);
        }
      });
    }
  };

  // 监听来自 sidepanel 的手动提取请求
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'REQUEST_EXTRACT') {
      const data = JDExtractor.extract();
      console.log('[比价助手] 手动提取结果:', data);
      sendResponse({ data });
    }
    if (msg.type === 'DIAGNOSE') {
      const info = ContentCommon.diagnose();
      console.log('[比价助手] 诊断信息:', info);
      sendResponse({ data: info });
    }
  });

  JDExtractor.init();
})();

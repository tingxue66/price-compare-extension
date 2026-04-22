/**
 * 淘宝/天猫商品页内容脚本
 * 提取商品信息并发送到 background
 */

(function () {
  const TaobaoExtractor = {
    // 淘宝/天猫页面结构变化频繁，准备多套选择器
    selectors: {
      // 淘宝选择器
      taobao: {
        title: [
          '.ItemHeader--mainTitle--3CIjqW',
          'h1[class*="mainTitle"]',
          '.tb-main-title',
          '#J_Title .tb-main-title',
          'div[class*="Title"] h1',
          'meta[name="title"]'
        ],
        price: [
          'span[class*="priceInt"]',
          '.Price--priceInt--2KlBn',
          'span[class*="Price--priceInt"]',
          '.tb-rmb-num',
          '#J_StrPrice .tb-rmb-num',
          'div[class*="price"] span[class*="text"]',
          'span[class*="originPrice"]'
        ],
        originalPrice: [
          'span[class*="del"]',
          '.tb-price del',
          'div[class*="originalPrice"]',
          'span[class*="lineThrough"]'
        ],
        store: [
          'a[class*="ShopHeader--title"]',
          '.ShopHeader--title--2dLIr',
          'a[class*="shopName"]',
          '.tb-shop-name a',
          '#J_ShopInfo .tb-shop-name a',
          'div[class*="shop"] a[class*="name"]'
        ],
        image: [
          'img[class*="mainPic"]',
          '.PicGallery--mainPic--2P4qH img',
          '#J_ImgBooth',
          '.tb-main-pic img',
          'img[class*="Gallery"]',
          'div[class*="picGallery"] img'
        ]
      },
      // 天猫选择器
      tmall: {
        title: [
          '.ItemHeader--mainTitle--3CIjqW',
          'h1[class*="mainTitle"]',
          '.tb-detail-hd h1',
          'div[data-title]',
          '.ItemInfo--title--2REDOG',
          '[class*="ItemHeader"] h1',
          '[class*="title"] h1'
        ],
        price: [
          'span[class*="Price--priceInt"]',
          '.tm-price',
          '.tm-promo-price .tm-price',
          'span[class*="priceInt"]',
          '.Price--priceInt--2KlBn',
          '[class*="priceText"]',
          '[class*="PriceText"]',
          '[class*="mainPrice"]',
          '[class*="MainPrice"]',
          '[class*="tradePrice"]',
          '[class*="TradePrice"]',
          '[class*="couponPrice"]',
          '[class*="CouponPrice"]',
          '[class*="finalPrice"]',
          '[class*="FinalPrice"]',
          '[class*="activityPrice"]',
          '[class*="ActivityPrice"]'
        ],
        originalPrice: [
          '.tm-price-original',
          'span[class*="lineThrough"]',
          'del[class*="price"]',
          '[class*="originPrice"]',
          '[class*="OriginPrice"]',
          '[class*="strike"]',
          '[class*="linePrice"]'
        ],
        store: [
          'a[class*="ShopHeader--title"]',
          '.ShopHeader--title--2dLIr',
          '.slogo-shopname a',
          '.shopLink',
          'a[class*="shopName"]',
          '[class*="shopName"]',
          '[class*="ShopName"]',
          '[class*="sellerName"]'
        ],
        image: [
          'img[class*="mainPic"]',
          '#J_ImgBooth',
          '.PicGallery--mainPic--2P4qH img',
          '.tb-main-pic img'
        ]
      }
    },

    /**
     * 检测当前是淘宝还是天猫
     */
    detectSubPlatform() {
      if (/tmall\.com/.test(location.hostname)) return 'tmall';
      return 'taobao';
    },

    /**
     * 提取商品ID
     */
    extractId() {
      const match = location.href.match(/[?&]id=(\d+)/);
      return match ? match[1] : null;
    },

    /**
     * 尝试从 meta 标签获取标题
     */
    getTitleFromMeta() {
      const meta = document.querySelector('meta[name="title"]');
      if (meta) return meta.getAttribute('content') || '';
      // 也可以从 document.title 中提取
      const dt = document.title;
      if (dt) {
        // 去掉末尾的 "-淘宝网" 或 "-天猫Tmall.com"
        return dt.replace(/[-\s]*(淘宝网|天猫|Tmall\.com|tmall\.com).*$/i, '').trim();
      }
      return '';
    },

    isVisible(el) {
      if (!el || !(el instanceof Element)) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    },

    scorePriceElement(el, mode = 'current') {
      if (!this.isVisible(el)) return null;

      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 80) return null;

      const price = ContentCommon.parsePrice(text);
      if (price === null || price <= 0 || price > 9999999) return null;

      if (/评价|客服|进店|分期|发货|免运费|收藏|关注店铺|直播|优惠券|补贴\d+%|政府补贴|领券/.test(text)) {
        return null;
      }

      const className = (el.className || '').toString();
      const style = window.getComputedStyle(el);
      const fontSize = parseFloat(style.fontSize) || 0;
      const color = style.color || '';
      const lineThrough = (style.textDecorationLine || '').includes('line-through');
      const isReddish = /rgb\(\s*(2[0-5]\d|1[6-9]\d)/.test(color);

      let score = 0;

      if (/price|Price|trade|Trade|promo|Promo|final|Final|coupon|Coupon|activity|Activity|origin|Origin/.test(className)) {
        score += 3;
      }

      if (fontSize >= 24) score += 4;
      else if (fontSize >= 18) score += 3;
      else if (fontSize >= 14) score += 1;

      if (isReddish) score += 2;

      if (mode === 'current') {
        if (/券后|到手|活动价|折后|现价|售价|惊爆价|预估到手|优惠价|¥|￥/.test(text)) score += 5;
        if (/优惠前|原价|参考价|划线价|日常价/.test(text)) score -= 4;
        if (lineThrough) score -= 4;
      } else {
        if (/优惠前|原价|参考价|划线价|日常价/.test(text)) score += 5;
        if (lineThrough) score += 3;
        if (/券后|到手|活动价|折后/.test(text)) score -= 3;
      }

      return { el, price, score, fontSize };
    },

    extractPriceByHeuristics(mode = 'current') {
      const selectors = [
        '[class*="Price"]',
        '[class*="price"]',
        '[class*="Trade"]',
        '[class*="trade"]',
        '[class*="Promo"]',
        '[class*="promo"]',
        '[class*="Activity"]',
        '[class*="activity"]',
        'span',
        'strong',
        'em',
        'div'
      ];

      const seen = new Set();
      const candidates = [];

      for (const selector of selectors) {
        document.querySelectorAll(selector).forEach(el => {
          if (seen.has(el)) return;
          seen.add(el);
          const candidate = this.scorePriceElement(el, mode);
          if (candidate && candidate.score >= 4) {
            candidates.push(candidate);
          }
        });
      }

      candidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.fontSize !== a.fontSize) return b.fontSize - a.fontSize;
        if (mode === 'current') return a.price - b.price;
        return b.price - a.price;
      });

      return candidates[0]?.price ?? null;
    },

    /**
     * 提取完整商品信息
     */
    extract() {
      const productId = this.extractId();
      if (!productId) return null;

      const subPlatform = this.detectSubPlatform();
      const sel = this.selectors[subPlatform];

      let title = ContentCommon.getText(sel.title);
      if (!title) title = this.getTitleFromMeta();

      let price = ContentCommon.getPrice(sel.price);
      let originalPrice = ContentCommon.getPrice(sel.originalPrice);

      if (price === null) {
        price = this.extractPriceByHeuristics('current');
      }

      if (originalPrice === null) {
        originalPrice = this.extractPriceByHeuristics('original');
      }

      const store = ContentCommon.getText(sel.store);
      const image = ContentCommon.getImage(sel.image);

      if (!title) return null;

      return {
        platform: subPlatform,
        productId,
        title,
        price,
        originalPrice,
        store,
        url: location.href,
        image: image ? (image.startsWith('//') ? 'https:' + image : image) : '',
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
      // 判断是否为商品详情页
      const isProduct = /item\.taobao\.com\/item\.htm/.test(location.href) ||
        /detail\.tmall\.com\/item\.htm/.test(location.href) ||
        /chaoshi\.detail\.tmall\.com/.test(location.href);

      if (!isProduct) return;

      // 淘宝页面加载较慢，需要更长等待
      const subPlatform = this.detectSubPlatform();
      const priceSelectors = [
        ...this.selectors[subPlatform].price,
        ...this.selectors[subPlatform].title
      ];

      const tryExtract = (attempt = 1) => {
        const data = this.extract();
        if (data && data.price !== null) {
          ContentCommon.sendProductData(data);
        } else if (attempt < 6) {
          setTimeout(() => tryExtract(attempt + 1), attempt * 1200);
        } else if (data) {
          ContentCommon.sendProductData(data);
        }
      };

      setTimeout(() => tryExtract(), 1200);

      ContentCommon.waitForElement(priceSelectors, () => {
        setTimeout(() => tryExtract(), 800);
      }, 15000);

      // 监听 URL 变化
      ContentCommon.onUrlChange((url) => {
        if (/item\.htm/.test(url)) {
          setTimeout(() => tryExtract(), 1500);
        }
      });
    }
  };

  // 监听来自 sidepanel 的手动提取请求
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'REQUEST_EXTRACT') {
      const data = TaobaoExtractor.extract();
      sendResponse({ data });
    }
    if (msg.type === 'DIAGNOSE') {
      const info = ContentCommon.diagnose();
      console.log('[比价助手] 诊断信息:', info);
      sendResponse({ data: info });
    }
  });

  TaobaoExtractor.init();
})();

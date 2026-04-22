/**
 * 商品卡片组件 — Tab 1 当前商品比价
 */

const ProductCard = {
  currentProduct: null,

  /**
   * 更新显示当前商品信息
   */
  show(product) {
    this.currentProduct = product;
    document.getElementById('no-product').classList.add('hidden');
    document.getElementById('product-info').classList.remove('hidden');

    // 填充商品数据
    const img = document.getElementById('product-img');
    if (product.image) {
      img.src = product.image;
      img.classList.remove('hidden');
    } else {
      img.classList.add('hidden');
    }

    document.getElementById('product-title').textContent = product.title;

    const platformTag = document.getElementById('product-platform');
    platformTag.textContent = PlatformUtil.getPlatformName(product.platform);
    platformTag.className = 'platform-tag ' + product.platform;

    const storeEl = document.getElementById('product-store');
    if (product.store) {
      storeEl.textContent = product.store;
      storeEl.classList.remove('hidden');
    } else {
      storeEl.textContent = '';
      storeEl.classList.add('hidden');
    }

    const priceEl = document.getElementById('product-price');
    priceEl.textContent = (product.price !== null && product.price !== undefined)
      ? product.price.toFixed(2) : '获取中...';

    const originalPriceEl = document.getElementById('product-original-price');
    if (product.originalPrice && product.price !== null && product.originalPrice > product.price) {
      originalPriceEl.textContent = product.originalPrice.toFixed(2);
      originalPriceEl.classList.remove('hidden');
    } else {
      originalPriceEl.classList.add('hidden');
    }

    // 显示搜索按钮
    this.updateSearchButtons(product.platform, product.store);

    // 加载历史对比记录
    this.loadCompareHistory(product);
  },

  /**
   * 隐藏商品信息，显示空状态
   */
  hide() {
    this.currentProduct = null;
    document.getElementById('no-product').classList.remove('hidden');
    document.getElementById('product-info').classList.add('hidden');
  },

  /**
   * 根据当前平台和店铺信息，显示对应的搜索按钮
   */
  updateSearchButtons(currentPlatform, storeName) {
    const btnJd = document.getElementById('btn-search-jd');
    const btnTaobao = document.getElementById('btn-search-taobao');
    const storeGroup = document.getElementById('store-search-group');
    const btnStoreJd = document.getElementById('btn-store-jd');
    const btnStoreTaobao = document.getElementById('btn-store-taobao');

    // --- 搜商品按钮 ---
    if (currentPlatform === 'jd') {
      btnJd.classList.add('hidden');
      btnTaobao.classList.remove('hidden');
      btnTaobao.textContent = '去淘宝搜商品';
    } else {
      btnTaobao.classList.add('hidden');
      btnJd.classList.remove('hidden');
      btnJd.textContent = '去京东搜商品';
    }

    // --- 搜同店按钮：只在有店铺名时显示 ---
    if (storeName) {
      const brand = PlatformUtil.extractBrand(storeName);
      storeGroup.classList.remove('hidden');

      if (currentPlatform === 'jd') {
        btnStoreJd.classList.add('hidden');
        btnStoreTaobao.classList.remove('hidden');
        // 旗舰店 → 优先搜天猫
        const targetName = PlatformUtil.isOfficialStore(storeName) ? '天猫' : '淘宝';
        btnStoreTaobao.textContent = `去${targetName}搜${brand || '同店'}`;
      } else {
        btnStoreTaobao.classList.add('hidden');
        btnStoreJd.classList.remove('hidden');
        btnStoreJd.textContent = `去京东搜${brand || '同店'}`;
      }
    } else {
      storeGroup.classList.add('hidden');
    }
  },

  /**
   * 加载历史对比记录
   */
  async loadCompareHistory(product) {
    const section = document.getElementById('compare-history');
    const container = document.getElementById('compare-records');

    if (!product.productKey) {
      section.classList.add('hidden');
      return;
    }

    const history = await StorageUtil.getHistoryForProduct(product);
    if (!history || history.records.length < 2) {
      section.classList.add('hidden');
      return;
    }

    // 按平台分组，取每个平台最新的价格
    const latest = {};
    for (const record of history.records) {
      if (record.price === null || record.price === undefined) continue;
      const key = record.platform === 'tmall' ? 'taobao' : record.platform;
      if (!latest[key] || new Date(record.date) > new Date(latest[key].date)) {
        latest[key] = record;
      }
    }

    if (Object.keys(latest).length < 2) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    container.innerHTML = '';

    const platforms = Object.keys(latest).sort();
    const prices = platforms.map(p => latest[p].price);
    const minPrice = Math.min(...prices);

    for (const platform of platforms) {
      const record = latest[platform];
      const div = document.createElement('div');
      div.className = 'compare-item';

      const diffHtml = record.price === minPrice
        ? '<span class="price-diff cheaper">最低</span>'
        : `<span class="price-diff expensive">贵 ¥${(record.price - minPrice).toFixed(2)}</span>`;

      div.innerHTML = `
        <span class="compare-platform">${PlatformUtil.getPlatformName(platform)}</span>
        <span class="compare-price">${record.price.toFixed(2)}</span>
        ${diffHtml}
        <span class="compare-date">${new Date(record.date).toLocaleDateString()}</span>
      `;
      container.appendChild(div);
    }
  },

  /**
   * 跳转到另一平台搜索商品（普通搜索）
   */
  searchOnPlatform(targetPlatform) {
    if (!this.currentProduct) return;
    chrome.runtime.sendMessage({
      type: 'SEARCH_OTHER_PLATFORM',
      data: {
        keyword: this.currentProduct.title,
        targetPlatform,
        searchMode: 'product'
      }
    });
  },

  /**
   * 跳转到另一平台搜同店（带店铺/品牌名搜索）
   */
  searchStoreOnPlatform(targetPlatform) {
    if (!this.currentProduct) return;
    const store = this.currentProduct.store;
    const isOfficial = PlatformUtil.isOfficialStore(store);

    // 如果是旗舰店且目标是淘宝，自动切到天猫
    let actualTarget = targetPlatform;
    if (isOfficial && targetPlatform === 'taobao') {
      actualTarget = 'tmall';
    }

    chrome.runtime.sendMessage({
      type: 'SEARCH_OTHER_PLATFORM',
      data: {
        keyword: this.currentProduct.title,
        targetPlatform: actualTarget,
        storeName: store,
        searchMode: 'store'
      }
    });
  },

  /**
   * 添加当前商品到关注清单
   */
  async addToWatchlist() {
    if (!this.currentProduct) return;
    const response = await chrome.runtime.sendMessage({
      type: 'ADD_TO_WATCHLIST',
      data: {
        title: this.currentProduct.title,
        keyword: PlatformUtil.extractKeywords(this.currentProduct.title),
        platform: this.currentProduct.platform,
        price: this.currentProduct.price,
        originalPrice: this.currentProduct.originalPrice,
        url: this.currentProduct.url,
        productId: this.currentProduct.productId,
        image: this.currentProduct.image,
        store: this.currentProduct.store
      }
    });
    if (response.success) {
      App.showToast('已加入关注清单');
    }
  }
};

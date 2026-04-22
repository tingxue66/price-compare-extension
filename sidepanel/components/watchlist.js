const Watchlist = {
  items: [],
  settings: null,
  refreshStatus: null,

  async load() {
    const [watchlistResponse, settingsResponse, statusResponse] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_WATCHLIST' }).catch(() => null),
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }).catch(() => null),
      chrome.runtime.sendMessage({ type: 'GET_REFRESH_STATUS' }).catch(() => null)
    ]);

    this.items = watchlistResponse?.data || [];
    this.settings = settingsResponse?.data || {};
    this.refreshStatus = statusResponse?.data || {};
    this.render();
  },

  render() {
    this.renderRefreshPanel();
    this.renderList();
  },

  renderRefreshPanel() {
    const panelEl = document.getElementById('watchlist-refresh-panel');
    if (!panelEl) return;

    const enabled = !!this.settings?.autoRefreshEnabled;
    const intervalMinutes = Number(this.settings?.autoRefreshIntervalMinutes) || 60;
    const running = !!this.refreshStatus?.running;

    panelEl.innerHTML = `
      <div class="refresh-panel">
        <div class="refresh-panel-top">
          <div>
            <div class="refresh-panel-title">自动刷新</div>
            <div class="refresh-panel-meta">浏览器保持开启时，后台按间隔刷新已绑定的商品页</div>
          </div>
          <label class="switch">
            <input id="auto-refresh-enabled" type="checkbox" ${enabled ? 'checked' : ''}>
            <span class="switch-slider"></span>
          </label>
        </div>
        <div class="refresh-panel-controls">
          <label class="refresh-control">
            <span>刷新间隔</span>
            <select id="auto-refresh-interval" class="select">
              ${this.renderIntervalOption(30, intervalMinutes)}
              ${this.renderIntervalOption(60, intervalMinutes)}
              ${this.renderIntervalOption(120, intervalMinutes)}
              ${this.renderIntervalOption(240, intervalMinutes)}
            </select>
          </label>
          <button
            id="btn-refresh-now"
            class="btn btn-primary btn-sm"
            ${running ? 'disabled' : ''}
          >
            ${running ? '刷新中...' : '立即刷新'}
          </button>
        </div>
        <div class="refresh-status ${running ? 'running' : ''}">
          ${this.renderRefreshStatus()}
        </div>
      </div>
    `;

    this.bindRefreshEvents();
  },

  renderIntervalOption(value, currentValue) {
    return `
      <option value="${value}" ${value === currentValue ? 'selected' : ''}>
        ${value} 分钟
      </option>
    `;
  },

  renderRefreshStatus() {
    const status = this.refreshStatus || {};
    const enabled = !!this.settings?.autoRefreshEnabled;
    const lines = [];

    if (status.running) {
      lines.push(`<div class="refresh-status-line">后台刷新进行中：${status.completed || 0}/${status.total || 0}</div>`);

      if (status.current?.title) {
        const platformName = PlatformUtil.getPlatformName(status.current.platform || '');
        lines.push(`
          <div class="refresh-status-line refresh-status-current">
            当前：${this.escapeHtml(status.current.title)}
            ${platformName ? ` · ${platformName}` : ''}
          </div>
        `);
      }

      if (status.startedAt) {
        lines.push(`<div class="refresh-status-line">开始时间：${this.formatTime(status.startedAt)}</div>`);
      }
    } else if (enabled) {
      lines.push('<div class="refresh-status-line">自动刷新已开启，浏览器开启期间会按设定间隔执行。</div>');
    } else {
      lines.push('<div class="refresh-status-line">自动刷新已关闭，只会在你手动点击时刷新。</div>');
    }

    if (status.lastAutoRefreshAt) {
      const reasonLabel = this.getRefreshReasonLabel(status.lastAutoRefreshReason);
      lines.push(`
        <div class="refresh-status-line">
          上次${reasonLabel}：${this.formatTime(status.lastAutoRefreshAt)}
          (${status.lastAutoRefreshCount || 0}/${status.lastAutoRefreshTotal || 0})
        </div>
      `);
    } else {
      lines.push('<div class="refresh-status-line">还没有执行过后台刷新。</div>');
    }

    if (status.error) {
      lines.push(`<div class="refresh-status-line refresh-status-error">最近错误：${this.escapeHtml(status.error)}</div>`);
    }

    return lines.join('');
  },

  bindRefreshEvents() {
    const toggle = document.getElementById('auto-refresh-enabled');
    const interval = document.getElementById('auto-refresh-interval');
    const refreshButton = document.getElementById('btn-refresh-now');

    if (toggle) {
      toggle.onchange = async (event) => {
        const response = await chrome.runtime.sendMessage({
          type: 'UPDATE_SETTINGS',
          data: {
            autoRefreshEnabled: event.target.checked
          }
        });

        if (response?.success) {
          this.settings = response.data;
          this.refreshStatus = await this.fetchRefreshStatus();
          this.renderRefreshPanel();
          App.showToast(event.target.checked ? '已开启自动刷新' : '已关闭自动刷新');
        } else {
          App.showToast(response?.error || '设置保存失败');
          event.target.checked = !event.target.checked;
        }
      };
    }

    if (interval) {
      interval.onchange = async (event) => {
        const minutes = Number(event.target.value) || 60;
        const response = await chrome.runtime.sendMessage({
          type: 'UPDATE_SETTINGS',
          data: {
            autoRefreshIntervalMinutes: minutes
          }
        });

        if (response?.success) {
          this.settings = response.data;
          this.refreshStatus = await this.fetchRefreshStatus();
          this.renderRefreshPanel();
          App.showToast(`刷新间隔已设为 ${minutes} 分钟`);
        } else {
          App.showToast(response?.error || '刷新间隔保存失败');
        }
      };
    }

    if (refreshButton) {
      refreshButton.onclick = async () => {
        const response = await chrome.runtime.sendMessage({ type: 'REFRESH_WATCHLIST_NOW' });
        if (response?.success) {
          this.refreshStatus = response.data || this.refreshStatus;
          this.renderRefreshPanel();
          App.showToast('已开始后台刷新');
        } else {
          App.showToast(response?.error || '刷新任务已在进行中');
        }
      };
    }
  },

  async fetchRefreshStatus() {
    const response = await chrome.runtime.sendMessage({ type: 'GET_REFRESH_STATUS' }).catch(() => null);
    return response?.data || {};
  },

  applyRefreshStatus(status) {
    this.refreshStatus = status || {};
    this.renderRefreshPanel();
  },

  renderList() {
    const emptyEl = document.getElementById('watchlist-empty');
    const listEl = document.getElementById('watchlist-items');

    if (!emptyEl || !listEl) return;

    if (this.items.length === 0) {
      emptyEl.classList.remove('hidden');
      listEl.innerHTML = '';
      return;
    }

    emptyEl.classList.add('hidden');
    listEl.innerHTML = this.items.map((item) => this.renderItem(item)).join('');
    this.bindItemEvents();
  },

  renderItem(item) {
    const jdBound = !!(item.jd && (item.jd.url || item.jd.productId));
    const taobaoBound = !!(item.taobao && (item.taobao.url || item.taobao.productId));
    const boundCount = [jdBound, taobaoBound].filter(Boolean).length;
    const taobaoDisplayName = this.getDisplayPlatformName(item.taobao, 'taobao');
    const hasOfficial = !!(
      item.jd?.official || item.taobao?.official || PlatformUtil.isOfficialStore(item.store || '')
    );
    const summaryText = boundCount >= 2 ? '双平台已配对' : '待绑定另一个平台';

    let diffHtml = '';
    const jdHasPrice = item.jd && item.jd.price !== null && item.jd.price !== undefined;
    const tbHasPrice = item.taobao && item.taobao.price !== null && item.taobao.price !== undefined;

    if (jdHasPrice && tbHasPrice) {
      const diff = item.jd.price - item.taobao.price;
      if (Math.abs(diff) > 0.01) {
        const cheaper = diff > 0 ? taobaoDisplayName : '京东';
        diffHtml = `<span class="price-diff cheaper">${cheaper}便宜 ¥${Math.abs(diff).toFixed(2)}</span>`;
      } else {
        diffHtml = '<span class="price-diff">价格相同</span>';
      }
    }

    const brand = item.store ? PlatformUtil.extractBrand(item.store) : '';
    const hasStore = !!item.store;
    const storeLabel = brand || '同店';

    let buttonsHtml = `
      <button class="btn btn-sm btn-jd btn-search-item" data-id="${item.id}" data-platform="jd" data-mode="product">搜京东</button>
      <button class="btn btn-sm btn-taobao btn-search-item" data-id="${item.id}" data-platform="taobao" data-mode="product">搜${taobaoDisplayName}</button>
    `;

    if (hasStore) {
      buttonsHtml += `
        <button class="btn btn-sm btn-jd-outline btn-search-item" data-id="${item.id}" data-platform="jd" data-mode="store">京东${storeLabel}</button>
        <button class="btn btn-sm btn-taobao-outline btn-search-item" data-id="${item.id}" data-platform="taobao" data-mode="store">${taobaoDisplayName}${storeLabel}</button>
      `;
    }

    buttonsHtml += `
      <button class="btn btn-sm btn-primary btn-bind-current" data-id="${item.id}">绑定当前页</button>
    `;

    return `
      <div class="watchlist-item" data-id="${item.id}">
        <div class="watchlist-item-header">
          <span class="watchlist-item-title">${this.escapeHtml(item.title)}</span>
          <button class="btn-danger btn-remove" data-id="${item.id}">删除</button>
        </div>
        <div class="watchlist-monitor-meta">
          <span class="monitor-badge ${boundCount >= 2 ? 'ready' : 'pending'}">${summaryText}</span>
          ${hasOfficial ? '<span class="monitor-badge official">官方店</span>' : ''}
        </div>
        <div class="watchlist-prices">
          ${this.renderPlatformCard('jd', item.jd)}
          ${this.renderPlatformCard('taobao', item.taobao)}
        </div>
        ${diffHtml ? `<div style="text-align:center;margin-top:6px">${diffHtml}</div>` : ''}
        <div class="watchlist-actions">
          ${buttonsHtml}
        </div>
      </div>
    `;
  },

  renderPlatformCard(platform, platformData) {
    const displayPlatform = this.getDisplayPlatformKey(platformData, platform);
    const displayName = PlatformUtil.getPlatformName(displayPlatform);
    const bound = !!(platformData && (platformData.url || platformData.productId));
    const hasPrice = platformData && platformData.price !== null && platformData.price !== undefined;
    const storeHtml = platformData?.store
      ? `<div class="watchlist-store-name">${this.escapeHtml(platformData.store)}</div>`
      : '';
    const timeHtml = platformData?.lastChecked
      ? `<div class="watchlist-time">更新于 ${this.formatTime(platformData.lastChecked)}</div>`
      : '<div class="watchlist-time">尚未更新</div>';

    return `
      <div class="watchlist-price-item ${bound ? 'bound' : 'unbound'} ${displayPlatform}">
        <div class="watchlist-price-label-row">
          <div class="watchlist-price-label">${displayName}</div>
          <span class="watchlist-bind-state ${bound ? 'bound' : 'unbound'}">${bound ? '已绑定' : '未绑定'}</span>
        </div>
        ${hasPrice
          ? `<span class="watchlist-price-value">${platformData.price.toFixed(2)}</span>`
          : `<span class="watchlist-price-value empty">${bound ? '待更新' : '未绑定'}</span>`}
        ${storeHtml}
        ${timeHtml}
      </div>
    `;
  },

  getDisplayPlatformKey(platformData, fallbackPlatform) {
    const detectedPlatform = PlatformUtil.detectPlatform(platformData?.url);
    if (platformData?.platform === 'tmall') return 'tmall';
    if (platformData?.platform === 'taobao') return 'taobao';
    if (detectedPlatform === 'tmall') return 'tmall';
    if (detectedPlatform === 'taobao') return 'taobao';
    return fallbackPlatform;
  },

  getDisplayPlatformName(platformData, fallbackPlatform) {
    return PlatformUtil.getPlatformName(this.getDisplayPlatformKey(platformData, fallbackPlatform));
  },

  bindItemEvents() {
    document.querySelectorAll('.btn-remove').forEach((button) => {
      button.onclick = async (event) => {
        const id = event.currentTarget.dataset.id;
        await chrome.runtime.sendMessage({
          type: 'REMOVE_FROM_WATCHLIST',
          data: { itemId: id }
        });
        App.showToast('已从清单移除');
        this.load();
      };
    });

    document.querySelectorAll('.btn-search-item').forEach((button) => {
      button.onclick = (event) => {
        const id = event.currentTarget.dataset.id;
        const platform = event.currentTarget.dataset.platform;
        const mode = event.currentTarget.dataset.mode || 'product';
        const item = this.items.find((candidate) => candidate.id === id);
        if (!item) return;

        const messageData = {
          keyword: item.keyword || item.title,
          targetPlatform: platform,
          searchMode: mode
        };

        if (mode === 'store' && item.store) {
          messageData.storeName = item.store;
          if (platform === 'taobao' && PlatformUtil.isOfficialStore(item.store)) {
            messageData.targetPlatform = 'tmall';
          }
        }

        chrome.runtime.sendMessage({
          type: 'SEARCH_OTHER_PLATFORM',
          data: messageData
        });
      };
    });

    document.querySelectorAll('.btn-bind-current').forEach((button) => {
      button.onclick = async (event) => {
        const id = event.currentTarget.dataset.id;
        const response = await chrome.runtime.sendMessage({
          type: 'BIND_CURRENT_PRODUCT_TO_WATCHLIST',
          data: { itemId: id }
        });

        if (response?.success) {
          const platformName = PlatformUtil.getPlatformName(response.product?.platform || '');
          App.showToast(`已绑定当前${platformName}商品页`);
          this.load();
        } else {
          App.showToast(response?.error || '绑定失败');
        }
      };
    });
  },

  async addManual(keyword) {
    if (!keyword.trim()) return;

    await chrome.runtime.sendMessage({
      type: 'ADD_TO_WATCHLIST',
      data: {
        title: keyword.trim(),
        keyword: keyword.trim(),
        platform: 'manual',
        price: null,
        url: '',
        image: '',
        store: ''
      }
    });

    App.showToast('已添加到清单');
    this.load();
  },

  getRefreshReasonLabel(reason) {
    if (reason === 'manual') return '手动刷新';
    if (reason === 'alarm') return '自动刷新';
    return '刷新';
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  },

  formatTime(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '--';

    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${month}-${day} ${hour}:${minute}`;
  }
};

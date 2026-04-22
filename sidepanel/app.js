/**
 * 侧边栏主逻辑
 * 初始化、Tab 切换、事件绑定、消息监听
 */

const App = {
  activeTab: 'compare',

  /**
   * 初始化
   */
  init() {
    this.bindTabs();
    this.bindCompareEvents();
    this.bindWatchlistEvents();
    this.bindHistoryEvents();
    this.listenMessages();
    this.loadCurrentProduct();
  },

  // ========== Tab 切换 ==========

  bindTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        this.switchTab(target);
      });
    });
  },

  switchTab(tabName) {
    this.activeTab = tabName;

    // 更新 Tab 按钮状态
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });

    // 更新 Tab 内容
    document.querySelectorAll('.tab-content').forEach(c => {
      c.classList.toggle('hidden', c.id !== `tab-${tabName}`);
      c.classList.toggle('active', c.id === `tab-${tabName}`);
    });

    // 切换到对应 Tab 时加载数据
    if (tabName === 'watchlist') {
      Watchlist.load();
    } else if (tabName === 'history') {
      PriceChart.loadProductList();
    }
  },

  // ========== Tab 1: 比价事件 ==========

  bindCompareEvents() {
    // 手动提取
    document.getElementById('btn-manual-extract').addEventListener('click', async () => {
      const response = await chrome.runtime.sendMessage({ type: 'REQUEST_EXTRACT_ACTIVE_TAB' });
      if (response && response.data) {
        ProductCard.show(response.data);
        document.getElementById('diagnose-result').classList.add('hidden');
      } else {
        this.showToast(response?.error || '未检测到商品信息');
      }
    });

    // 诊断按钮
    document.getElementById('btn-diagnose').addEventListener('click', async () => {
      const resultEl = document.getElementById('diagnose-result');
      resultEl.classList.remove('hidden');
      resultEl.textContent = '正在诊断...';
      const response = await chrome.runtime.sendMessage({ type: 'DIAGNOSE_ACTIVE_TAB' });
      if (response && response.data) {
        resultEl.textContent = JSON.stringify(response.data, null, 2);
      } else {
        resultEl.textContent = '诊断失败: ' + (response?.error || '未知错误') +
          '\n\n请确保：\n1. 当前标签页是京东/淘宝商品页\n2. 安装插件后已刷新页面';
      }
    });

    // 搜商品（普通跨平台搜索）
    document.getElementById('btn-search-jd').addEventListener('click', () => {
      ProductCard.searchOnPlatform('jd');
    });
    document.getElementById('btn-search-taobao').addEventListener('click', () => {
      ProductCard.searchOnPlatform('taobao');
    });

    // 搜同店（带品牌/店铺名搜索）
    document.getElementById('btn-store-jd').addEventListener('click', () => {
      ProductCard.searchStoreOnPlatform('jd');
    });
    document.getElementById('btn-store-taobao').addEventListener('click', () => {
      ProductCard.searchStoreOnPlatform('taobao');
    });

    // 加入清单
    document.getElementById('btn-add-watchlist').addEventListener('click', () => {
      ProductCard.addToWatchlist();
    });
  },

  // ========== Tab 2: 清单事件 ==========

  bindWatchlistEvents() {
    const form = document.getElementById('manual-add-form');
    const input = document.getElementById('input-keyword');

    // 显示/隐藏手动添加表单
    document.getElementById('btn-add-manual').addEventListener('click', () => {
      form.classList.toggle('hidden');
      if (!form.classList.contains('hidden')) {
        input.focus();
      }
    });

    // 确认添加
    document.getElementById('btn-confirm-add').addEventListener('click', () => {
      Watchlist.addManual(input.value);
      input.value = '';
      form.classList.add('hidden');
    });

    // 回车添加
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        Watchlist.addManual(input.value);
        input.value = '';
        form.classList.add('hidden');
      }
    });
  },

  // ========== Tab 3: 历史事件 ==========

  bindHistoryEvents() {
    document.getElementById('history-select').addEventListener('change', (e) => {
      PriceChart.loadHistory(e.target.value);
    });
  },

  // ========== 消息监听 ==========

  listenMessages() {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'PRODUCT_UPDATED' && msg.data) {
        ProductCard.show(msg.data);

        if (this.activeTab === 'history') {
          PriceChart.loadProductList();
        }
      }

      if (msg.type === 'WATCHLIST_UPDATED') {
        if (this.activeTab === 'watchlist') {
          Watchlist.load();
        }

        if (this.activeTab === 'history') {
          PriceChart.loadProductList();
        }
      }

      if (msg.type === 'REFRESH_STATUS_UPDATED' && this.activeTab === 'watchlist') {
        Watchlist.applyRefreshStatus(msg.data);
      }
    });
  },

  // ========== 加载当前商品 ==========

  async loadCurrentProduct() {
    const response = await chrome.runtime.sendMessage({ type: 'GET_CURRENT_PRODUCT' });
    if (response && response.data) {
      ProductCard.show(response.data);
    } else {
      // 尝试从当前标签页提取
      const extractResponse = await chrome.runtime.sendMessage({ type: 'REQUEST_EXTRACT_ACTIVE_TAB' });
      if (extractResponse && extractResponse.data) {
        ProductCard.show(extractResponse.data);
      }
    }
  },

  // ========== Toast 提示 ==========

  showToast(message, duration = 2000) {
    let toast = document.querySelector('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), duration);
  }
};

// 启动
document.addEventListener('DOMContentLoaded', () => App.init());

importScripts('../utils/platform.js', '../utils/storage.js');

const CURRENT_PRODUCT_KEY = 'currentProduct';
const AUTO_REFRESH_ALARM = 'watchlist-auto-refresh';
const MIN_AUTO_REFRESH_INTERVAL_MINUTES = 30;
const DEFAULT_AUTO_REFRESH_INTERVAL_MINUTES = 60;
const REFRESH_TAB_COMPLETE_TIMEOUT_MS = 30000;
const REFRESH_TAB_EXTRACT_TIMEOUT_MS = 45000;
const REFRESH_RETRY_DELAY_MS = 1800;
const REFRESH_GAP_MS = 1500;

let currentProductCache = null;
let refreshInProgress = false;
let refreshState = {
  running: false,
  reason: '',
  startedAt: null,
  completed: 0,
  total: 0,
  current: null,
  error: '',
  lastFinishedAt: null
};

const refreshSessions = new Map();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasPrice(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeIntervalMinutes(value) {
  const interval = Number(value);
  if (!Number.isFinite(interval)) return DEFAULT_AUTO_REFRESH_INTERVAL_MINUTES;
  return Math.max(MIN_AUTO_REFRESH_INTERVAL_MINUTES, Math.round(interval));
}

function normalizeSettingsUpdate(partial = {}) {
  const next = { ...partial };

  if (Object.prototype.hasOwnProperty.call(next, 'autoRefreshEnabled')) {
    next.autoRefreshEnabled = Boolean(next.autoRefreshEnabled);
  }

  if (Object.prototype.hasOwnProperty.call(next, 'autoRefreshIntervalMinutes')) {
    next.autoRefreshIntervalMinutes = normalizeIntervalMinutes(next.autoRefreshIntervalMinutes);
  }

  return next;
}

function buildProductInfo(rawProduct, fallbackUrl = '') {
  if (!rawProduct || !rawProduct.title) return null;

  const url = rawProduct.url || fallbackUrl || '';
  const title = String(rawProduct.title || '').trim();
  if (!title) return null;

  const platform = rawProduct.platform || PlatformUtil.detectPlatform(url) || '';
  const productId = rawProduct.productId || PlatformUtil.extractProductId(url) || '';

  return {
    ...rawProduct,
    title,
    url,
    platform,
    productId,
    price: toNumberOrNull(rawProduct.price),
    originalPrice: toNumberOrNull(rawProduct.originalPrice),
    extractedAt: rawProduct.extractedAt || Date.now(),
    productKey: rawProduct.productKey || PlatformUtil.generateProductKey(title)
  };
}

async function safeSendRuntimeMessage(message) {
  try {
    await chrome.runtime.sendMessage(message);
  } catch (error) {
    if (!error?.message || !error.message.includes('Receiving end does not exist')) {
      console.debug('[price-compare] runtime message skipped:', error?.message || error);
    }
  }
}

async function updateBadge() {
  const watchlist = await StorageUtil.getWatchlist();
  const count = watchlist.length;

  await chrome.action.setBadgeBackgroundColor({ color: '#4285f4' });
  await chrome.action.setBadgeText({
    text: count > 0 ? String(Math.min(count, 99)) : ''
  });
}

async function loadCurrentProduct() {
  if (currentProductCache) return currentProductCache;
  currentProductCache = await StorageUtil.get(CURRENT_PRODUCT_KEY);
  return currentProductCache || null;
}

async function setCurrentProduct(productInfo) {
  currentProductCache = productInfo;
  await StorageUtil.set(CURRENT_PRODUCT_KEY, productInfo);
  return productInfo;
}

async function notifyProductUpdated(productInfo) {
  await safeSendRuntimeMessage({
    type: 'PRODUCT_UPDATED',
    data: productInfo
  });
}

async function notifyWatchlistUpdated() {
  await updateBadge();
  await safeSendRuntimeMessage({ type: 'WATCHLIST_UPDATED' });
}

async function getRefreshStatus() {
  const settings = await StorageUtil.getSettings();

  return {
    enabled: !!settings.autoRefreshEnabled,
    intervalMinutes: normalizeIntervalMinutes(settings.autoRefreshIntervalMinutes),
    running: refreshState.running,
    reason: refreshState.reason,
    startedAt: refreshState.startedAt,
    completed: refreshState.completed,
    total: refreshState.total,
    current: refreshState.current,
    error: refreshState.error,
    lastFinishedAt: refreshState.lastFinishedAt,
    lastAutoRefreshAt: settings.lastAutoRefreshAt,
    lastAutoRefreshReason: settings.lastAutoRefreshReason || '',
    lastAutoRefreshCount: settings.lastAutoRefreshCount || 0,
    lastAutoRefreshTotal: settings.lastAutoRefreshTotal || 0
  };
}

async function notifyRefreshStatusUpdated() {
  await safeSendRuntimeMessage({
    type: 'REFRESH_STATUS_UPDATED',
    data: await getRefreshStatus()
  });
}

async function handleProductExtracted(rawProduct, options = {}) {
  const productInfo = buildProductInfo(rawProduct);
  if (!productInfo) {
    return {
      product: null,
      updatedItems: []
    };
  }

  if (options.recordHistory !== false && hasPrice(productInfo.price)) {
    await StorageUtil.recordPrice(productInfo);
  }

  const updatedItems = await StorageUtil.syncWatchlistByProduct(productInfo);

  if (options.updateCurrent !== false) {
    await setCurrentProduct(productInfo);
  }

  if (updatedItems.length > 0) {
    await notifyWatchlistUpdated();
  }

  if (options.notifyProduct !== false) {
    await notifyProductUpdated(productInfo);
  }

  return {
    product: productInfo,
    updatedItems
  };
}

async function requestMessageFromTab(tabId, type) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type });
    return response?.data || null;
  } catch (error) {
    return null;
  }
}

async function requestExtractFromTab(tabId, fallbackUrl = '') {
  const responseData = await requestMessageFromTab(tabId, 'REQUEST_EXTRACT');
  return buildProductInfo(responseData, fallbackUrl);
}

async function diagnoseTab(tabId) {
  return await requestMessageFromTab(tabId, 'DIAGNOSE');
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  return tabs[0] || null;
}

async function extractAndPersistTabProduct(tabId, options = {}) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.id) return null;

  let product = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    product = await requestExtractFromTab(tab.id, tab.url || '');
    if (product) break;
    await delay(700 * (attempt + 1));
  }

  if (!product) return null;
  await handleProductExtracted(product, options);
  return product;
}

async function extractActiveTabProduct(options = {}) {
  const tab = await getActiveTab();
  if (!tab?.id) return null;
  return await extractAndPersistTabProduct(tab.id, options);
}

async function waitForTabComplete(tabId, timeoutMs = REFRESH_TAB_COMPLETE_TIMEOUT_MS) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) throw new Error('Tab not found');
  if (tab.status === 'complete') return tab;

  return await new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error('Tab load timeout'));
    }, timeoutMs);

    function onUpdated(updatedTabId, changeInfo, updatedTab) {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(updatedTab);
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

function createRefreshSession(tabId, task) {
  let resolver;
  let rejecter;

  const promise = new Promise((resolve, reject) => {
    resolver = resolve;
    rejecter = reject;
  });

  const session = {
    tabId,
    task,
    completed: false,
    processed: false,
    timeoutId: null,
    promise,
    resolve(value) {
      if (session.completed) return;
      session.completed = true;
      clearTimeout(session.timeoutId);
      resolver(value);
    },
    reject(error) {
      if (session.completed) return;
      session.completed = true;
      clearTimeout(session.timeoutId);
      rejecter(error);
    }
  };

  session.timeoutId = setTimeout(() => {
    session.reject(new Error('Refresh extract timeout'));
  }, REFRESH_TAB_EXTRACT_TIMEOUT_MS);

  refreshSessions.set(tabId, session);
  return session;
}

function cleanupRefreshSession(tabId) {
  const session = refreshSessions.get(tabId);
  if (!session) return;
  clearTimeout(session.timeoutId);
  refreshSessions.delete(tabId);
}

async function handleRefreshSessionExtract(tabId, rawProduct, fallbackUrl = '') {
  const session = refreshSessions.get(tabId);
  if (!session) return null;
  if (session.processed) return session.promise;

  session.processed = true;

  try {
    const productInfo = buildProductInfo(rawProduct, fallbackUrl || session.task.url);
    const result = await handleProductExtracted(productInfo, {
      recordHistory: false,
      updateCurrent: false,
      notifyProduct: false
    });
    session.resolve(result.product);
    return result.product;
  } catch (error) {
    session.reject(error);
    throw error;
  }
}

async function closeTab(tabId) {
  await chrome.tabs.remove(tabId).catch(() => undefined);
}

async function runRefreshTask(task) {
  const tab = await chrome.tabs.create({
    url: task.url,
    active: false
  });

  const session = createRefreshSession(tab.id, task);

  try {
    await waitForTabComplete(tab.id);

    if (!session.completed) {
      await delay(1000);
    }

    if (!session.completed) {
      const extracted = await requestExtractFromTab(tab.id, task.url);
      if (extracted) {
        await handleRefreshSessionExtract(tab.id, extracted, task.url);
      }
    }

    if (!session.completed) {
      await delay(REFRESH_RETRY_DELAY_MS);
      const retryExtracted = await requestExtractFromTab(tab.id, task.url);
      if (retryExtracted) {
        await handleRefreshSessionExtract(tab.id, retryExtracted, task.url);
      }
    }

    await session.promise;
    return true;
  } catch (error) {
    console.debug('[price-compare] refresh task failed:', task.url, error?.message || error);
    return false;
  } finally {
    await closeTab(tab.id);
    cleanupRefreshSession(tab.id);
  }
}

async function buildRefreshTasks() {
  const watchlist = await StorageUtil.getWatchlist();
  const seen = new Set();
  const tasks = [];

  for (const item of watchlist) {
    for (const platformKey of ['jd', 'taobao']) {
      const snapshot = item?.[platformKey];
      const url = snapshot?.url || '';
      if (!url || !PlatformUtil.isProductPage(url)) continue;

      const platform = snapshot.platform || PlatformUtil.detectPlatform(url) || platformKey;
      const dedupeKey = `${platform}:${url}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      tasks.push({
        itemId: item.id,
        title: item.title,
        platform,
        url,
        lastChecked: snapshot.lastChecked || 0
      });
    }
  }

  tasks.sort((a, b) => a.lastChecked - b.lastChecked);
  return tasks;
}

async function finishRefreshRun(reason, successCount, totalCount) {
  const finishedAt = Date.now();
  refreshInProgress = false;
  refreshState.running = false;
  refreshState.reason = reason;
  refreshState.current = null;
  refreshState.completed = totalCount;
  refreshState.total = totalCount;
  refreshState.lastFinishedAt = finishedAt;

  await StorageUtil.updateSettings({
    lastAutoRefreshAt: finishedAt,
    lastAutoRefreshReason: reason,
    lastAutoRefreshCount: successCount,
    lastAutoRefreshTotal: totalCount
  });

  await notifyRefreshStatusUpdated();
}

async function runRefreshQueue(tasks, reason) {
  let successCount = 0;

  try {
    for (let index = 0; index < tasks.length; index += 1) {
      const task = tasks[index];

      refreshState.current = {
        itemId: task.itemId,
        title: task.title,
        platform: task.platform,
        url: task.url
      };
      refreshState.completed = index;
      refreshState.error = '';
      await notifyRefreshStatusUpdated();

      const ok = await runRefreshTask(task);
      if (ok) {
        successCount += 1;
      }

      refreshState.completed = index + 1;
      await notifyRefreshStatusUpdated();

      if (index < tasks.length - 1) {
        await delay(REFRESH_GAP_MS);
      }
    }
  } catch (error) {
    refreshState.error = error?.message || 'Refresh failed';
  } finally {
    await finishRefreshRun(reason, successCount, tasks.length);
  }
}

async function beginRefreshWatchlist(reason = 'manual') {
  if (refreshInProgress) {
    return {
      started: false,
      status: await getRefreshStatus(),
      error: 'Refresh is already running'
    };
  }

  const tasks = await buildRefreshTasks();

  refreshInProgress = true;
  refreshState = {
    running: true,
    reason,
    startedAt: Date.now(),
    completed: 0,
    total: tasks.length,
    current: null,
    error: '',
    lastFinishedAt: refreshState.lastFinishedAt
  };

  await notifyRefreshStatusUpdated();
  void runRefreshQueue(tasks, reason);

  return {
    started: true,
    status: await getRefreshStatus()
  };
}

async function applyAutoRefreshSettings() {
  const settings = await StorageUtil.getSettings();
  const enabled = !!settings.autoRefreshEnabled;
  const intervalMinutes = normalizeIntervalMinutes(settings.autoRefreshIntervalMinutes);

  await chrome.alarms.clear(AUTO_REFRESH_ALARM);

  if (!enabled) {
    await notifyRefreshStatusUpdated();
    return;
  }

  await chrome.alarms.create(AUTO_REFRESH_ALARM, {
    delayInMinutes: intervalMinutes,
    periodInMinutes: intervalMinutes
  });

  await notifyRefreshStatusUpdated();
}

async function openSearchResults(data = {}) {
  const keyword = (data.keyword || '').trim();
  const targetPlatform = data.targetPlatform;
  const searchMode = data.searchMode || 'product';

  if (!keyword || !targetPlatform) {
    throw new Error('Missing search keyword or target platform');
  }

  if (searchMode === 'store' && data.storeName) {
    const urls = PlatformUtil.buildStoreSearchUrls(targetPlatform, keyword, data.storeName) || [];
    if (urls.length === 0) {
      throw new Error('No store search urls available');
    }

    for (let index = 0; index < urls.length; index += 1) {
      await chrome.tabs.create({
        url: urls[index].url,
        active: index === 0
      });
    }

    return urls;
  }

  const url = PlatformUtil.buildSearchUrl(targetPlatform, keyword);
  if (!url) {
    throw new Error('Unsupported target platform');
  }

  await chrome.tabs.create({ url, active: true });
  return [{ url }];
}

async function initializeExtension() {
  await updateBadge();
  await applyAutoRefreshSettings();

  if (chrome.sidePanel?.setPanelBehavior) {
    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    } catch (error) {
      console.debug('[price-compare] side panel behavior skipped:', error?.message || error);
    }
  }
}

async function maybeExtractActiveProduct(tabId) {
  if (!tabId || refreshSessions.has(tabId)) return;

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url || !PlatformUtil.isProductPage(tab.url)) return;

  await delay(1200);
  await extractAndPersistTabProduct(tabId, {
    recordHistory: true,
    updateCurrent: true,
    notifyProduct: true
  }).catch(() => null);
}

async function handleMessage(message, sender) {
  switch (message?.type) {
    case 'PRODUCT_EXTRACTED': {
      const refreshTabId = sender?.tab?.id;
      if (refreshTabId && refreshSessions.has(refreshTabId)) {
        const product = await handleRefreshSessionExtract(refreshTabId, message.data, sender?.tab?.url || '');
        return { success: true, data: product };
      }

      const result = await handleProductExtracted(message.data, {
        recordHistory: true,
        updateCurrent: true,
        notifyProduct: true
      });
      return { success: true, data: result.product };
    }

    case 'GET_CURRENT_PRODUCT': {
      return { success: true, data: await loadCurrentProduct() };
    }

    case 'SEARCH_OTHER_PLATFORM': {
      return { success: true, data: await openSearchResults(message.data || {}) };
    }

    case 'ADD_TO_WATCHLIST': {
      const item = await StorageUtil.addToWatchlist(message.data || {});
      await notifyWatchlistUpdated();
      return { success: true, data: item };
    }

    case 'GET_WATCHLIST': {
      return { success: true, data: await StorageUtil.getWatchlist() };
    }

    case 'REMOVE_FROM_WATCHLIST': {
      await StorageUtil.removeFromWatchlist(message.data?.itemId);
      await notifyWatchlistUpdated();
      return { success: true };
    }

    case 'UPDATE_WATCHLIST_PRICE': {
      const updatedItem = await StorageUtil.updateWatchlistItem(
        message.data?.itemId,
        message.data?.platform,
        message.data?.priceData || {}
      );
      if (updatedItem) {
        await notifyWatchlistUpdated();
      }
      return { success: true, data: updatedItem };
    }

    case 'BIND_CURRENT_PRODUCT_TO_WATCHLIST': {
      const product = await extractActiveTabProduct({
        recordHistory: true,
        updateCurrent: true,
        notifyProduct: false
      }) || await loadCurrentProduct();

      if (!product) {
        return {
          success: false,
          error: '当前页面未识别到商品'
        };
      }

      const item = await StorageUtil.bindProductToWatchlist(message.data?.itemId, product);
      if (!item) {
        return {
          success: false,
          error: '当前商品暂不支持绑定到该监控项'
        };
      }

      await notifyWatchlistUpdated();
      return {
        success: true,
        data: item,
        product
      };
    }

    case 'GET_HISTORY': {
      return {
        success: true,
        data: await StorageUtil.getHistory(message.data?.productKey)
      };
    }

    case 'GET_ALL_HISTORY_KEYS': {
      return {
        success: true,
        data: await StorageUtil.getAllHistoryKeys()
      };
    }

    case 'REQUEST_EXTRACT_ACTIVE_TAB': {
      const product = await extractActiveTabProduct({
        recordHistory: true,
        updateCurrent: true,
        notifyProduct: false
      });

      if (!product) {
        return {
          success: false,
          error: '当前标签页未识别到商品信息'
        };
      }

      return {
        success: true,
        data: product
      };
    }

    case 'DIAGNOSE_ACTIVE_TAB': {
      const tab = await getActiveTab();
      if (!tab?.id) {
        return {
          success: false,
          error: '当前没有可诊断的标签页'
        };
      }

      const data = await diagnoseTab(tab.id);
      if (!data) {
        return {
          success: false,
          error: '当前标签页暂不支持诊断'
        };
      }

      return {
        success: true,
        data
      };
    }

    case 'GET_SETTINGS': {
      return {
        success: true,
        data: await StorageUtil.getSettings()
      };
    }

    case 'UPDATE_SETTINGS': {
      const settings = await StorageUtil.updateSettings(normalizeSettingsUpdate(message.data || {}));
      await applyAutoRefreshSettings();
      return {
        success: true,
        data: settings
      };
    }

    case 'GET_REFRESH_STATUS': {
      return {
        success: true,
        data: await getRefreshStatus()
      };
    }

    case 'REFRESH_WATCHLIST_NOW': {
      const result = await beginRefreshWatchlist('manual');
      return {
        success: result.started,
        data: result.status,
        error: result.error || ''
      };
    }

    default:
      return { success: false, error: 'Unknown message type' };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void initializeExtension();
});

chrome.runtime.onStartup.addListener(() => {
  void initializeExtension();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== AUTO_REFRESH_ALARM) return;
  void beginRefreshWatchlist('alarm');
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void maybeExtractActiveProduct(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab?.active) return;
  void maybeExtractActiveProduct(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const session = refreshSessions.get(tabId);
  if (!session) return;
  session.reject(new Error('Refresh tab was closed'));
  cleanupRefreshSession(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => {
      sendResponse({
        success: false,
        error: error?.message || 'Unexpected background error'
      });
    });

  return true;
});

void initializeExtension();

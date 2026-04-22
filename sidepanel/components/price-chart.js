/**
 * 价格走势图组件 — Tab 3
 */

const PriceChart = {
  chart: null,
  activeKey: '',

  /**
   * 加载历史商品列表到下拉框
   */
  async loadProductList() {
    const response = await chrome.runtime.sendMessage({ type: 'GET_ALL_HISTORY_KEYS' });
    const items = response.data || [];
    const select = document.getElementById('history-select');
    const previousValue = this.activeKey || select.value;

    // 保留第一个默认选项
    select.innerHTML = '<option value="">选择商品查看历史</option>';

    // 按最新记录时间排序
    items.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'watchlist' ? -1 : 1;
      }
      const dateA = a.lastRecord ? new Date(a.lastRecord.date) : 0;
      const dateB = b.lastRecord ? new Date(b.lastRecord.date) : 0;
      return dateB - dateA;
    });

    for (const item of items) {
      const option = document.createElement('option');
      option.value = item.key;
      const prefix = item.type === 'watchlist' ? '监控' : '页面';
      option.textContent = `${prefix} | ${item.title} (${item.recordCount}条记录)`;
      select.appendChild(option);
    }

    // 如果没有记录，显示空状态
    if (items.length === 0) {
      document.getElementById('history-empty').classList.remove('hidden');
      document.getElementById('history-content').classList.add('hidden');
      this.activeKey = '';
      return;
    }

    const targetValue = items.some(item => item.key === previousValue)
      ? previousValue
      : items[0].key;

    if (targetValue) {
      select.value = targetValue;
      this.loadHistory(targetValue);
    }
  },

  /**
   * 加载并渲染某商品的价格历史
   */
  async loadHistory(productKey) {
    this.activeKey = productKey || '';

    if (!productKey) {
      document.getElementById('history-empty').classList.remove('hidden');
      document.getElementById('history-content').classList.add('hidden');
      return;
    }

    const response = await chrome.runtime.sendMessage({
      type: 'GET_HISTORY',
      data: { productKey }
    });

    const history = response.data;
    const records = (history?.records || [])
      .filter(record => record.price !== null && record.price !== undefined)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (!history || records.length === 0) {
      document.getElementById('history-empty').classList.remove('hidden');
      document.getElementById('history-content').classList.add('hidden');
      return;
    }

    document.getElementById('history-empty').classList.add('hidden');
    document.getElementById('history-content').classList.remove('hidden');

    this.renderChart(records);
    this.renderStats(records);
    this.renderRecordsList(records);
  },

  /**
   * 渲染价格走势图
   */
  renderChart(records) {
    const ctx = document.getElementById('price-chart').getContext('2d');

    // 销毁旧图表
    if (this.chart) {
      this.chart.destroy();
    }

    // 如果 Chart.js 未加载，显示文字提示
    if (typeof Chart === 'undefined') {
      document.getElementById('price-chart').parentElement.innerHTML =
        '<p style="text-align:center;color:#999;padding:20px;">图表加载失败</p>';
      return;
    }

    // 收集所有时间点并排序去重，作为 x 轴标签
    const allDates = [...new Set(records.map(r => r.date))].sort();
    const labels = allDates.map(d => this.formatDate(d));

    // 按平台分组，将价格对齐到统一时间轴
    const jdRecords = records.filter(r => r.platform === 'jd');
    const taobaoRecords = records.filter(r => r.platform === 'taobao' || r.platform === 'tmall');

    const mapToLabels = (platformRecords) => {
      const dateMap = {};
      for (const r of platformRecords) {
        dateMap[r.date] = r.price;
      }
      return allDates.map(d => dateMap[d] ?? null);
    };

    const datasets = [];

    if (jdRecords.length > 0) {
      datasets.push({
        label: '京东',
        data: mapToLabels(jdRecords),
        borderColor: '#e1251b',
        backgroundColor: 'rgba(225, 37, 27, 0.1)',
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: '#e1251b',
        tension: 0.3,
        fill: false,
        spanGaps: true
      });
    }

    if (taobaoRecords.length > 0) {
      datasets.push({
        label: '淘宝/天猫',
        data: mapToLabels(taobaoRecords),
        borderColor: '#ff5000',
        backgroundColor: 'rgba(255, 80, 0, 0.1)',
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: '#ff5000',
        tension: 0.3,
        fill: false,
        spanGaps: true
      });
    }

    this.chart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'nearest',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'top',
            labels: { font: { size: 11 }, usePointStyle: true }
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const price = context.parsed.y;
                return (price !== null && price !== undefined)
                  ? `${context.dataset.label}: ¥${price.toFixed(2)}`
                  : `${context.dataset.label}: -`;
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { font: { size: 10 }, maxRotation: 45, maxTicksLimit: 10 }
          },
          y: {
            ticks: {
              font: { size: 10 },
              callback: (v) => '¥' + v
            }
          }
        }
      }
    });
  },

  /**
   * 渲染统计信息
   */
  renderStats(records) {
    const container = document.getElementById('history-stats');
    const prices = records.map(r => r.price).filter(p => p !== null);

    if (prices.length === 0) {
      container.innerHTML = '';
      return;
    }

    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const latestRecord = records[records.length - 1];
    const latest = latestRecord.price;
    const count = records.length;
    const platformSummary = {};

    for (const record of records) {
      const key = record.platform === 'tmall' ? 'taobao' : record.platform;
      platformSummary[key] = record;
    }

    const summaryText = Object.entries(platformSummary)
      .map(([key, record]) => `${PlatformUtil.getPlatformName(key)} ¥${record.price.toFixed(2)}`)
      .join(' / ');

    container.innerHTML = `
      <div class="stat-card">
        <div class="stat-label">历史最低</div>
        <div class="stat-value price">${min.toFixed(2)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">历史最高</div>
        <div class="stat-value price">${max.toFixed(2)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">当前价格</div>
        <div class="stat-value price">${latest.toFixed(2)}</div>
        ${summaryText ? `<div class="stat-subtext">${summaryText}</div>` : ''}
      </div>
      <div class="stat-card">
        <div class="stat-label">记录次数</div>
        <div class="stat-value">${count}</div>
      </div>
    `;
  },

  /**
   * 渲染最近记录列表
   */
  renderRecordsList(records) {
    const container = document.getElementById('history-records');
    const recent = records.slice(-20).reverse();

    container.innerHTML = `
      <h4>最近记录</h4>
      ${recent.map(r => `
        <div class="record-item">
          <span class="record-platform ${r.platform === 'tmall' ? 'taobao' : r.platform}">${PlatformUtil.getPlatformName(r.platform)}</span>
          <span class="record-price">¥${r.price !== null ? r.price.toFixed(2) : '-'}</span>
          <span class="record-date">${this.formatDate(r.date)}</span>
        </div>
      `).join('')}
    `;
  },

  /**
   * 格式化日期
   */
  formatDate(dateStr) {
    const d = new Date(dateStr);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hour = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${month}-${day} ${hour}:${min}`;
  }
};

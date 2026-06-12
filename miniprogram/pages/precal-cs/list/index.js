const precalService = require('../../../services/precalService');
const { formatMoney, formatPercent } = require('../../../utils/precalCalculator');

Page({
  data: {
    loading: false,
    loadingMore: false,
    keyword: '',
    filterStatus: 'all',
    records: [],
    page: 1,
    pageSize: 20,
    hasMore: true,
    statusOptions: [
      { label: '全部', value: 'all' },
      { label: '待绑定', value: 'Submitted' },
      { label: '已绑定SAP', value: 'SAP Bound' },
      { label: '已创建项目', value: 'Project Created' }
    ]
  },
  onShow() { this.loadData(); },
  onPullDownRefresh() { this.loadData().finally(() => wx.stopPullDownRefresh()); },
  onReachBottom() { this.loadMore(); },
  label(status) { return status === 'SAP Bound' ? '已绑定SAP' : status === 'Submitted' ? '待绑定SAP' : status === 'Project Created' ? '已创建项目' : status; },
  enrich(row) {
    const sapText = (row.sapNumbers || []).join('、');
    return Object.assign({}, row, {
      statusLabel: this.label(row.status),
      totalOrderValueText: formatMoney(row.totalOrderValue),
      operatingMarginText: formatPercent(row.operatingMargin),
      sapText,
      sapTextDisplay: sapText || '-',
      customerNameText: row.customerName || '未填写客户',
      salesOwnerNameText: row.salesOwnerName || '-',
      statusTagClass: row.status === 'SAP Bound' ? 'tag-normal' : 'tag-warning'
    });
  },
  loadData(options) {
    const opts = options || {};
    const reset = opts.reset !== false;
    if (this.data.loading || this.data.loadingMore) return Promise.resolve();
    const page = reset ? 1 : this.data.page + 1;
    this.setData(reset ? { loading: true, page: 1 } : { loadingMore: true });
    return precalService.callPrecalService('listPrecalForCS', {
      status: this.data.filterStatus,
      keyword: this.data.keyword,
      page,
      pageSize: this.data.pageSize
    })
      .then(res => {
        const rows = (res.records || []).map(item => this.enrich(item));
        this.setData({
          records: reset ? rows : this.data.records.concat(rows),
          page: res.page || page,
          pageSize: res.pageSize || this.data.pageSize,
          hasMore: !!res.hasMore
        });
      })
      .catch(err => wx.showToast({ title: err.message || '加载失败', icon: 'none' }))
      .finally(() => this.setData(reset ? { loading: false } : { loadingMore: false }));
  },
  loadMore() {
    if (!this.data.hasMore || this.data.loading || this.data.loadingMore) return;
    this.loadData({ reset: false });
  },
  onSearchInput(e) { this.setData({ keyword: e.detail.value || '' }); clearTimeout(this.timer); this.timer = setTimeout(() => this.loadData({ reset: true }), 300); },
  switchStatus(e) { this.setData({ filterStatus: e.currentTarget.dataset.status }, () => this.loadData({ reset: true })); },
  goBind(e) { wx.navigateTo({ url: `/pages/precal-cs/sap-bind/index?id=${e.currentTarget.dataset.id}` }); }
});

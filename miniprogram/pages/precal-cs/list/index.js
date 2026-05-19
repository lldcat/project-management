const precalService = require('../../../services/precalService');
const { formatMoney, formatPercent } = require('../../../utils/precalCalculator');

Page({
  data: {
    keyword: '',
    filterStatus: 'all',
    records: [],
    statusOptions: [
      { label: '全部', value: 'all' },
      { label: '待绑定', value: 'Submitted' },
      { label: '已绑定SAP', value: 'SAP Bound' }
    ]
  },
  onShow() { this.loadData(); },
  onPullDownRefresh() { this.loadData().finally(() => wx.stopPullDownRefresh()); },
  label(status) { return status === 'SAP Bound' ? '已绑定SAP' : status === 'Submitted' ? '待绑定SAP' : status; },
  enrich(row) { return Object.assign({}, row, { statusLabel: this.label(row.status), totalOrderValueText: formatMoney(row.totalOrderValue), operatingMarginText: formatPercent(row.operatingMargin), sapText: (row.sapNos || []).join('、') }); },
  loadData() {
    return precalService.callPrecalService('listPrecalForCS', { status: this.data.filterStatus, keyword: this.data.keyword })
      .then(res => this.setData({ records: (res.records || []).map(item => this.enrich(item)) }))
      .catch(err => wx.showToast({ title: err.message || '加载失败', icon: 'none' }));
  },
  onSearchInput(e) { this.setData({ keyword: e.detail.value || '' }); clearTimeout(this.timer); this.timer = setTimeout(() => this.loadData(), 300); },
  switchStatus(e) { this.setData({ filterStatus: e.currentTarget.dataset.status }, () => this.loadData()); },
  goBind(e) { wx.navigateTo({ url: `/pages/precal-cs/sap-bind/index?id=${e.currentTarget.dataset.id}` }); }
});

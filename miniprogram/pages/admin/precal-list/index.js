const precalService = require('../../../services/precalService');
const { formatMoney } = require('../../../utils/precalCalculator');

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
    actionId: '',
    statusOptions: [
      { label: '全部', value: 'all' },
      { label: '草稿', value: 'Draft' },
      { label: '已提交', value: 'Submitted' },
      { label: '已撤销', value: 'Withdrawn' },
      { label: '已绑定SAP', value: 'SAP Bound' },
      { label: '已创建项目', value: 'Project Created' },
      { label: '已解锁', value: 'Unlocked' },
      { label: '已取消', value: 'Cancelled' }
    ]
  },
  onShow() { this.loadData(); },
  onPullDownRefresh() { this.loadData().finally(() => wx.stopPullDownRefresh()); },
  noop() {},
  label(status) { const map = { Draft: '草稿', Submitted: '已提交', Withdrawn: '已撤销', 'SAP Bound': '已绑定SAP', 'Project Created': '已创建项目', Unlocked: '已解锁', Cancelled: '已取消' }; return map[status] || status; },
  enrich(row) {
    const sapText = (row.sapNumbers || []).join('、');
    const canMaintainSap = ['Submitted', 'SAP Bound', 'Project Created'].indexOf(row.status) >= 0;
    const canCancel = row.status !== 'Cancelled' && row.status !== 'Project Created';
    return Object.assign({}, row, {
      statusLabel: this.label(row.status),
      totalOrderValueText: formatMoney(row.totalOrderValue),
      sapText,
      sapTextDisplay: sapText || '-',
      customerNameText: row.customerName || '未填写客户',
      salesOwnerNameText: row.salesOwnerName || '-',
      canMaintainSap,
      canUnlock: row.status === 'SAP Bound' || row.status === 'Project Created',
      canCancel,
      hasActions: canMaintainSap || row.status === 'SAP Bound' || canCancel
    });
  },
  onReachBottom() { this.loadMore(); },
  loadData(options) {
    const opts = options || {};
    const reset = opts.reset !== false;
    if (this.data.loading || this.data.loadingMore) return Promise.resolve();
    const page = reset ? 1 : this.data.page + 1;
    this.setData(reset ? { loading: true, page: 1 } : { loadingMore: true });
    return precalService.callPrecalService('listPrecalForAdmin', {
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
  goDetail(e) { wx.navigateTo({ url: `/pages/precal/detail/index?id=${e.currentTarget.dataset.id}` }); },
  goParams() { wx.navigateTo({ url: '/pages/admin/precal-parameters/index' }); },
  goBindSap(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/precal-cs/sap-bind/index?id=${id}` });
  },
  unlock(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.actionId) return;
    wx.showModal({ title: '解锁 Pre-cal', content: '解锁后 Pre-cal 主数据可被修改。请填写原因。', editable: true, placeholderText: '解锁原因', success: modal => {
      if (!modal.confirm) return;
      this.setData({ actionId: id });
      precalService.callPrecalService('unlockPrecal', { precalRecordId: id, reason: modal.content || 'admin 解锁' })
        .then(() => { wx.showToast({ title: '已解锁', icon: 'success' }); this.loadData({ reset: true }); })
        .catch(err => wx.showToast({ title: err.message || '解锁失败', icon: 'none' }))
        .finally(() => this.setData({ actionId: '' }));
    } });
  },
  cancel(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.actionId) return;
    wx.showModal({ title: '取消 Pre-cal', content: '确认取消该 Pre-cal？请填写原因。', editable: true, placeholderText: '取消原因', success: modal => {
      if (!modal.confirm) return;
      this.setData({ actionId: id });
      precalService.callPrecalService('cancelPrecal', { precalRecordId: id, reason: modal.content || 'admin 取消' })
        .then(() => { wx.showToast({ title: '已取消', icon: 'success' }); this.loadData({ reset: true }); })
        .catch(err => wx.showToast({ title: err.message || '取消失败', icon: 'none' }))
        .finally(() => this.setData({ actionId: '' }));
    } });
  }
});

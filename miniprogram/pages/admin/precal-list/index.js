const precalService = require('../../../services/precalService');
const { formatMoney } = require('../../../utils/precalCalculator');

Page({
  data: {
    keyword: '',
    filterStatus: 'all',
    records: [],
    statusOptions: [
      { label: '全部', value: 'all' },
      { label: '草稿', value: 'Draft' },
      { label: '已提交', value: 'Submitted' },
      { label: '已撤销', value: 'Withdrawn' },
      { label: '已绑定SAP', value: 'SAP Bound' },
      { label: '已解锁', value: 'Unlocked' },
      { label: '已取消', value: 'Cancelled' }
    ]
  },
  onShow() { this.loadData(); },
  onPullDownRefresh() { this.loadData().finally(() => wx.stopPullDownRefresh()); },
  noop() {},
  label(status) { const map = { Draft: '草稿', Submitted: '已提交', Withdrawn: '已撤销', 'SAP Bound': '已绑定SAP', Unlocked: '已解锁', Cancelled: '已取消' }; return map[status] || status; },
  enrich(row) { return Object.assign({}, row, { statusLabel: this.label(row.status), totalOrderValueText: formatMoney(row.totalOrderValue), sapText: (row.sapNos || []).join('、') }); },
  loadData() {
    return precalService.callPrecalService('listPrecalForAdmin', { status: this.data.filterStatus, keyword: this.data.keyword })
      .then(res => this.setData({ records: (res.records || []).map(item => this.enrich(item)) }))
      .catch(err => wx.showToast({ title: err.message || '加载失败', icon: 'none' }));
  },
  onSearchInput(e) { this.setData({ keyword: e.detail.value || '' }); clearTimeout(this.timer); this.timer = setTimeout(() => this.loadData(), 300); },
  switchStatus(e) { this.setData({ filterStatus: e.currentTarget.dataset.status }, () => this.loadData()); },
  goDetail(e) { wx.navigateTo({ url: `/pages/precal/detail/index?id=${e.currentTarget.dataset.id}` }); },
  goParams() { wx.navigateTo({ url: '/pages/admin/precal-parameters/index' }); },
  unlock(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({ title: '解锁 Pre-cal', content: '解锁后 Pre-cal 主数据可被修改。请填写原因。', editable: true, placeholderText: '解锁原因', success: modal => {
      if (!modal.confirm) return;
      precalService.callPrecalService('unlockPrecal', { precalRecordId: id, reason: modal.content || 'admin 解锁' })
        .then(() => { wx.showToast({ title: '已解锁', icon: 'success' }); this.loadData(); })
        .catch(err => wx.showToast({ title: err.message || '解锁失败', icon: 'none' }));
    } });
  }
});

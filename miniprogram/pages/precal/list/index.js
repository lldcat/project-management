const precalService = require('../../../services/precalService');
const { formatMoney, formatPercent } = require('../../../utils/precalCalculator');

Page({
  data: {
    loading: false,
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

  statusLabel(status) {
    const map = { Draft: '草稿', Submitted: '已提交', Withdrawn: '已撤销', 'SAP Bound': '已绑定SAP', Unlocked: '已解锁', Cancelled: '已取消' };
    return map[status] || status;
  },

  enrich(row) {
    return Object.assign({}, row, {
      statusLabel: this.statusLabel(row.status),
      totalOrderValueText: formatMoney(row.totalOrderValue),
      operatingMarginText: formatPercent(row.operatingMargin),
      sapText: (row.sapNos || []).join('、')
    });
  },

  loadData() {
    this.setData({ loading: true });
    return precalService.callPrecalService('listMyPrecal', { status: this.data.filterStatus, keyword: this.data.keyword })
      .then(res => this.setData({ records: (res.records || []).map(item => this.enrich(item)) }))
      .catch(err => wx.showToast({ title: err.message || '加载失败', icon: 'none' }))
      .finally(() => this.setData({ loading: false }));
  },

  onSearchInput(e) { this.setData({ keyword: e.detail.value || '' }); clearTimeout(this.timer); this.timer = setTimeout(() => this.loadData(), 300); },
  switchStatus(e) { this.setData({ filterStatus: e.currentTarget.dataset.status }, () => this.loadData()); },
  createPrecal() { wx.navigateTo({ url: '/pages/precal/edit/index' }); },
  goDetail(e) { wx.navigateTo({ url: `/pages/precal/detail/index?id=${e.currentTarget.dataset.id}` }); },
  goEdit(e) { wx.navigateTo({ url: `/pages/precal/edit/index?id=${e.currentTarget.dataset.id}` }); },

  submit(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认提交', content: '提交后 CS 将可以看到该 Pre-cal。',
      success: modal => {
        if (!modal.confirm) return;
        precalService.callPrecalService('submitPrecal', { precalRecordId: id })
          .then(() => { wx.showToast({ title: '已提交', icon: 'success' }); this.loadData(); })
          .catch(err => wx.showToast({ title: err.message || '提交失败', icon: 'none' }));
      }
    });
  },

  withdraw(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '撤销 Pre-cal', content: '撤销后 CS 将暂时看不到该记录。请填写原因。', editable: true, placeholderText: '撤销原因',
      success: modal => {
        if (!modal.confirm) return;
        const reason = modal.content || 'Sales 撤销修改';
        precalService.callPrecalService('withdrawPrecal', { precalRecordId: id, reason })
          .then(() => { wx.showToast({ title: '已撤销', icon: 'success' }); this.loadData(); })
          .catch(err => wx.showToast({ title: err.message || '撤销失败', icon: 'none' }));
      }
    });
  }
});

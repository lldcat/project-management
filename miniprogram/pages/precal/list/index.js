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
    submittingId: '',
    withdrawingId: '',
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
  onReachBottom() { this.loadMore(); },
  noop() {},

  statusLabel(status) {
    const map = { Draft: '草稿', Submitted: '已提交', Withdrawn: '已撤销', 'SAP Bound': '已绑定SAP', Unlocked: '已解锁', Cancelled: '已取消' };
    return map[status] || status;
  },

  enrich(row) {
    const canEditOrSubmit = row.status === 'Draft' || row.status === 'Withdrawn' || row.status === 'Unlocked';
    return Object.assign({}, row, {
      statusLabel: this.statusLabel(row.status),
      totalOrderValueText: formatMoney(row.totalOrderValue),
      operatingMarginText: formatPercent(row.operatingMargin),
      sapText: (row.sapNumbers || []).join('、'),
      sapTextDisplay: (row.sapNumbers || []).join('、') || '-',
      customerNameText: row.customerName || '未填写客户',
      salesOwnerNameText: row.salesOwnerName || '-',
      statusTagClass: row.status === 'SAP Bound' ? 'tag-normal' : (row.status === 'Submitted' ? 'tag-warning' : ''),
      canEditOrSubmit,
      canWithdraw: row.status === 'Submitted'
    });
  },

  loadData(options) {
    const opts = options || {};
    const reset = opts.reset !== false;
    if (this.data.loading || this.data.loadingMore) return Promise.resolve();
    const page = reset ? 1 : this.data.page + 1;
    this.setData(reset ? { loading: true, page: 1 } : { loadingMore: true });
    return precalService.callPrecalService('listMyPrecal', {
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
  createPrecal() { wx.navigateTo({ url: '/pages/precal/edit/index' }); },
  goDetail(e) { wx.navigateTo({ url: `/pages/precal/detail/index?id=${e.currentTarget.dataset.id}` }); },
  goEdit(e) { wx.navigateTo({ url: `/pages/precal/edit/index?id=${e.currentTarget.dataset.id}` }); },

  submit(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.submittingId || this.data.withdrawingId) return;
    wx.showModal({
      title: '确认提交', content: '提交后 CS 将可以看到该 Pre-cal。',
      success: modal => {
        if (!modal.confirm) return;
        this.setData({ submittingId: id });
        precalService.callPrecalService('submitPrecal', { precalRecordId: id })
          .then(() => { wx.showToast({ title: '已提交', icon: 'success' }); this.loadData({ reset: true }); })
          .catch(err => wx.showToast({ title: err.message || '提交失败', icon: 'none' }))
          .finally(() => this.setData({ submittingId: '' }));
      }
    });
  },

  withdraw(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.submittingId || this.data.withdrawingId) return;
    wx.showModal({
      title: '撤销 Pre-cal', content: '撤销后 CS 将暂时看不到该记录。请填写原因。', editable: true, placeholderText: '撤销原因',
      success: modal => {
        if (!modal.confirm) return;
        const reason = modal.content || 'Sales 撤销修改';
        this.setData({ withdrawingId: id });
        precalService.callPrecalService('withdrawPrecal', { precalRecordId: id, reason })
          .then(() => { wx.showToast({ title: '已撤销', icon: 'success' }); this.loadData({ reset: true }); })
          .catch(err => wx.showToast({ title: err.message || '撤销失败', icon: 'none' }))
          .finally(() => this.setData({ withdrawingId: '' }));
      }
    });
  }
});

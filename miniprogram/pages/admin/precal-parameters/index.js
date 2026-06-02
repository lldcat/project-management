const precalService = require('../../../services/precalService');

Page({
  data: { parameters: {}, centersText: '' },
  onLoad() { this.loadParameters(); },
  loadParameters() {
    precalService.callPrecalService('getActiveParameters', {})
      .then(res => {
        const parameters = res.parameters || {};
        this.setData({ parameters, centersText: (parameters.orderCreateCenters || []).join(',') });
      })
      .catch(err => wx.showToast({ title: err.message || '加载失败', icon: 'none' }));
  },
  onBasicInput(e) {
    const field = e.currentTarget.dataset.field;
    const data = {};
    data['parameters.' + field] = e.detail.value;
    this.setData(data);
  },
  onCentersInput(e) { this.setData({ centersText: e.detail.value || '' }); },
  onRateInput(e) {
    const index = e.currentTarget.dataset.index;
    const field = e.currentTarget.dataset.field;
    const data = {};
    data['parameters.serviceRates[' + index + '].' + field] = e.detail.value;
    this.setData(data);
  },
  saveParameters() {
    const parameters = Object.assign({}, this.data.parameters, {
      orderCreateCenters: String(this.data.centersText || '').split(/[，,\s]+/).map(item => item.trim()).filter(Boolean)
    });
    wx.showLoading({ title: '保存中' });
    precalService.callPrecalService('updateParameters', { parameters })
      .then(() => wx.showToast({ title: '已保存', icon: 'success' }))
      .catch(err => wx.showToast({ title: err.message || '保存失败', icon: 'none' }))
      .finally(() => wx.hideLoading());
  }
});

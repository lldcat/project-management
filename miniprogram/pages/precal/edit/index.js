const precalService = require('../../../services/precalService');
const { calculatePrecal, formatMoney, formatPercent } = require('../../../utils/precalCalculator');

function createLine() {
  return {
    lineId: `L${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    productDescription: '',
    orderCreateCenter: '4820',
    orderValue: '',
    onsiteMD: '',
    offsiteMD: '',
    quotationMD: '',
    quotationMDOverridden: false,
    travelMD: '',
    travelMDOverridden: false,
    subcontractingTranslation: '',
    subcontractingDesign: '',
    subcontractingTravel: '',
    subcontractingOther: '',
    subcontractingIC: '',
    internalSubcon: '',
    otherProjectCosts: ''
  };
}

function defaultForm() {
  return {
    customerName: '',
    service: 'ESG',
    remark: '',
    lineItems: [createLine()]
  };
}

Page({
  data: {
    id: '',
    pageTitle: '新建 AUD Pre-cal',
    serviceOptions: ['ESG', 'CSR'],
    serviceIndex: 0,
    orderCreateCenters: ['1800', '2160', '4820', '4830', '4840', '4850'],
    parameters: null,
    form: defaultForm(),
    resultItems: [],
    scenario70: {},
    scenario80: {},
    formulaList: [],
    showScenario: false
  },

  onLoad(options) {
    const id = options && options.id ? options.id : '';
    this.setData({ id, pageTitle: id ? '编辑 AUD Pre-cal' : '新建 AUD Pre-cal' });
    this.loadParameters().then(() => {
      if (id) this.loadDetail(id);
      else this.refreshPreview();
    });
  },

  loadParameters() {
    return precalService.callPrecalService('getActiveParameters', {})
      .then(res => {
        const parameters = res.parameters || {};
        this.setData({ parameters, orderCreateCenters: parameters.orderCreateCenters || this.data.orderCreateCenters });
      })
      .catch(err => wx.showToast({ title: err.message || '参数加载失败', icon: 'none' }));
  },

  loadDetail(id) {
    wx.showLoading({ title: '加载中' });
    precalService.callPrecalService('getPrecalDetail', { precalRecordId: id })
      .then(res => {
        const r = res.record || {};
        const form = {
          customerName: r.customerName || '',
          service: r.service || 'ESG',
          remark: r.remark || '',
          lineItems: (r.lineItems && r.lineItems.length ? r.lineItems : [createLine()]).map(item => Object.assign(createLine(), item))
        };
        this.setData({
          form,
          parameters: r.parameterSnapshot || this.data.parameters,
          serviceIndex: this.data.serviceOptions.indexOf(form.service) >= 0 ? this.data.serviceOptions.indexOf(form.service) : 0
        }, () => this.refreshPreview());
      })
      .catch(err => wx.showToast({ title: err.message || '加载失败', icon: 'none' }))
      .finally(() => wx.hideLoading());
  },

  onBasicInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: e.detail.value }, () => this.refreshPreview());
  },

  onServiceChange(e) {
    const index = Number(e.detail.value || 0);
    this.setData({ serviceIndex: index, 'form.service': this.data.serviceOptions[index] }, () => this.refreshPreview());
  },

  onCenterChange(e) {
    const index = Number(e.detail.value || 0);
    const lineIndex = e.currentTarget.dataset.index;
    this.setData({ [`form.lineItems[${lineIndex}].orderCreateCenter`]: this.data.orderCreateCenters[index] }, () => this.refreshPreview());
  },

  onLineInput(e) {
    const index = e.currentTarget.dataset.index;
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.lineItems[${index}].${field}`]: e.detail.value }, () => this.refreshPreview());
  },

  onLineSwitch(e) {
    const index = e.currentTarget.dataset.index;
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.lineItems[${index}].${field}`]: e.detail.value }, () => this.refreshPreview());
  },

  addLine() {
    const list = this.data.form.lineItems.concat([createLine()]);
    this.setData({ 'form.lineItems': list }, () => this.refreshPreview());
  },

  removeLine(e) {
    const index = Number(e.currentTarget.dataset.index);
    const list = this.data.form.lineItems.slice();
    list.splice(index, 1);
    this.setData({ 'form.lineItems': list.length ? list : [createLine()] }, () => this.refreshPreview());
  },

  toggleScenario() { this.setData({ showScenario: !this.data.showScenario }); },

  refreshPreview() {
    if (!this.data.parameters) return;
    const result = calculatePrecal(this.data.form, this.data.parameters);
    const form = Object.assign({}, this.data.form, { lineItems: result.lineItems });
    const r = result.calculationResult || {};
    const s70 = result.productivityScenarios.productivity70 || {};
    const s80 = result.productivityScenarios.productivity80 || {};
    const formulas = result.formulaExplanations || {};
    const formulaList = Object.keys(formulas).map(key => Object.assign({ key }, formulas[key]));
    this.setData({
      form,
      resultItems: [
        { key: 'totalOrderValue', label: 'Total Order Value', value: formatMoney(r.totalOrderValue) },
        { key: 'totalMD', label: 'Total MD', value: r.totalMD || 0 },
        { key: 'totalHours', label: 'Hours', value: r.totalHours || 0 },
        { key: 'totalNetSales', label: 'Net Sales', value: formatMoney(r.totalNetSales) },
        { key: 'totalMDCosts', label: 'MD Costs', value: formatMoney(r.totalMDCosts) },
        { key: 'resultOfOrder', label: 'RO', value: formatMoney(r.resultOfOrder) },
        { key: 'roMargin', label: 'RO Margin', value: formatPercent(r.roMargin) },
        { key: 'overhead', label: 'Overhead', value: formatMoney(r.overhead) },
        { key: 'operatingResult', label: 'Operating Result', value: formatMoney(r.operatingResult) },
        { key: 'operatingMargin', label: 'Operating Margin', value: formatPercent(r.operatingMargin) }
      ],
      scenario70: { mdCostsText: s70.available ? formatMoney(s70.mdCosts) : '参数未维护', operatingMarginText: s70.available ? formatPercent(s70.operatingMargin) : '-' },
      scenario80: { mdCostsText: s80.available ? formatMoney(s80.mdCosts) : '参数未维护', operatingMarginText: s80.available ? formatPercent(s80.operatingMargin) : '-' },
      formulaList
    });
  },

  validate() {
    if (!String(this.data.form.customerName || '').trim()) return '请填写客户名称';
    if (!this.data.form.lineItems.length) return '至少需要一条服务明细';
    const bad = this.data.form.lineItems.findIndex(item => !item.orderCreateCenter);
    if (bad >= 0) return `第 ${bad + 1} 条明细缺少 Order Create Center`;
    return '';
  },

  buildPayload() {
    return Object.assign({}, this.data.form, { precalRecordId: this.data.id });
  },

  saveDraft() {
    const msg = this.validate();
    if (msg) {
      wx.showToast({ title: msg, icon: 'none' });
      return Promise.reject(new Error(msg));
    }
  
    wx.showLoading({ title: '保存中' });
    const action = this.data.id ? 'updatePrecal' : 'createPrecal';
  
    return precalService.callPrecalService(action, this.buildPayload())
      .then(res => {
        wx.hideLoading();
  
        if (!this.data.id && res.id) {
          this.setData({ id: res.id, pageTitle: '编辑 AUD Pre-cal' });
        }
  
        wx.showToast({ title: '已保存', icon: 'success' });
        return res;
      })
      .catch(err => {
        wx.hideLoading();
        wx.showToast({ title: err.message || '保存失败', icon: 'none' });
        throw err;
      });
  },

  saveAndSubmit() {
    this.saveDraft()
      .then(res => {
        const id = this.data.id || res.id;
        return precalService.callPrecalService('submitPrecal', { precalRecordId: id });
      })
      .then(() => {
        wx.showToast({ title: '已提交', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 500);
      })
      .catch(() => {});
  }
});

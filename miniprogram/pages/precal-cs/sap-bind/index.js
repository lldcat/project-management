const precalService = require('../../../services/precalService');
const { formatMoney, formatPercent } = require('../../../utils/precalCalculator');

function createItem(itemNo) {
  return { itemId: `I${Date.now()}_${Math.floor(Math.random() * 100000)}`, itemNo, itemDescription: '', remark: '' };
}
function createSap() {
  return { sapId: `S${Date.now()}_${Math.floor(Math.random() * 100000)}`, sapNo: '', items: [createItem('1000')] };
}
function nextItemNo(items) {
  const nums = (items || []).map(item => parseInt(item.itemNo, 10)).filter(num => !isNaN(num));
  let next = 1000;
  while (nums.indexOf(next) >= 0) next += 1000;
  return String(next);
}

Page({
  data: { id: '', record: {}, sapBindings: [], reason: '首次绑定SAP号', summary: {} },
  onLoad(options) { this.setData({ id: options.id || '' }); this.loadData(); },
  loadData() {
    return precalService.callPrecalService('getPrecalDetail', { precalRecordId: this.data.id })
      .then(res => {
        const record = res.record || {};
        const r = record.calculationResult || {};
        this.setData({
          record,
          sapBindings: record.sapBindings && record.sapBindings.length ? record.sapBindings : [createSap()],
          summary: { totalOrderValueText: formatMoney(r.totalOrderValue), operatingMarginText: formatPercent(r.operatingMargin) }
        });
      })
      .catch(err => wx.showToast({ title: err.message || '加载失败', icon: 'none' }));
  },
  onReasonInput(e) { this.setData({ reason: e.detail.value || '' }); },
  onSapInput(e) {
    const index = e.currentTarget.dataset.index;
    const field = e.currentTarget.dataset.field;
    this.setData({ [`sapBindings[${index}].${field}`]: e.detail.value });
  },
  onItemInput(e) {
    const si = e.currentTarget.dataset.sapIndex;
    const ii = e.currentTarget.dataset.itemIndex;
    const field = e.currentTarget.dataset.field;
    this.setData({ [`sapBindings[${si}].items[${ii}].${field}`]: e.detail.value });
  },
  addSap() { this.setData({ sapBindings: this.data.sapBindings.concat([createSap()]) }); },
  removeSap(e) {
    const index = Number(e.currentTarget.dataset.index);
    const list = this.data.sapBindings.slice();
    list.splice(index, 1);
    this.setData({ sapBindings: list.length ? list : [createSap()] });
  },
  addItem(e) {
    const index = Number(e.currentTarget.dataset.index);
    const list = this.data.sapBindings.slice();
    const items = list[index].items || [];
    items.push(createItem(nextItemNo(items)));
    list[index].items = items;
    this.setData({ sapBindings: list });
  },
  removeItem(e) {
    const si = Number(e.currentTarget.dataset.sapIndex);
    const ii = Number(e.currentTarget.dataset.itemIndex);
    const list = this.data.sapBindings.slice();
    const items = list[si].items || [];
    items.splice(ii, 1);
    list[si].items = items.length ? items : [createItem('1000')];
    this.setData({ sapBindings: list });
  },
  validate() {
    const sapSeen = {};
    for (let i = 0; i < this.data.sapBindings.length; i++) {
      const sap = this.data.sapBindings[i];
      if (!String(sap.sapNo || '').trim()) return `第 ${i + 1} 个 SAP号为空`;
      if (sapSeen[sap.sapNo]) return `SAP号 ${sap.sapNo} 重复`;
      sapSeen[sap.sapNo] = true;
      const itemSeen = {};
      for (let j = 0; j < (sap.items || []).length; j++) {
        const no = String(sap.items[j].itemNo || '').trim();
        if (!no) return `SAP ${sap.sapNo} 的第 ${j + 1} 个 item号为空`;
        if (itemSeen[no]) return `SAP ${sap.sapNo} 下 item号 ${no} 重复`;
        itemSeen[no] = true;
      }
    }
    return '';
  },
  saveSap() {
    const msg = this.validate();
    if (msg) { wx.showToast({ title: msg, icon: 'none' }); return; }
    wx.showLoading({ title: '保存中' });
    precalService.callPrecalService('bindSap', { precalRecordId: this.data.id, sapBindings: this.data.sapBindings, reason: this.data.reason || '保存 SAP 绑定信息' })
      .then(() => { wx.showToast({ title: '已保存', icon: 'success' }); setTimeout(() => wx.navigateBack(), 500); })
      .catch(err => wx.showToast({ title: err.message || '保存失败', icon: 'none' }))
      .finally(() => wx.hideLoading());
  }
});

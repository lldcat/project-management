const precalService = require('../../../services/precalService');
const { formatMoney, formatPercent } = require('../../../utils/precalCalculator');

function createItem(itemNo) {
  return { itemId: `I${Date.now()}_${Math.floor(Math.random() * 100000)}`, itemNo, itemDescription: '', remark: '' };
}
function createSap() {
  return { sapId: `S${Date.now()}_${Math.floor(Math.random() * 100000)}`, sapNo: '', memberName: '', remark: '' };
}
function nextItemNo(items) {
  const nums = (items || []).map(item => parseInt(item.itemNo, 10)).filter(num => !isNaN(num));
  let next = 1000;
  while (nums.indexOf(next) >= 0) next += 1000;
  return String(next);
}
function mergeLegacyItems(record) {
  const merged = [];
  const seen = {};
  const add = (raw) => {
    const itemNo = String((raw && raw.itemNo) || '').trim();
    const itemDescription = String((raw && raw.itemDescription) || '').trim();
    const remark = String((raw && raw.remark) || '').trim();
    const key = `${itemNo}|${itemDescription}|${remark}`;
    if (seen[key]) return;
    seen[key] = true;
    merged.push({
      itemId: raw.itemId || `I${Date.now()}_${Math.floor(Math.random() * 100000)}`,
      itemNo: itemNo || nextItemNo(merged),
      itemDescription,
      remark
    });
  };
  (record.itemList || []).forEach(add);
  (record.sapBindings || []).forEach(sap => (sap.items || []).forEach(add));
  return merged.length ? merged : [createItem('1000')];
}

Page({
  data: { id: '', record: {}, sapBindings: [], itemList: [], reason: '首次绑定SAP号', summary: {} },
  onLoad(options) { this.setData({ id: options.id || '' }); this.loadData(); },
  loadData() {
    return precalService.callPrecalService('getPrecalDetail', { precalRecordId: this.data.id })
      .then(res => {
        const record = res.record || {};
        const r = record.calculationResult || {};
        this.setData({
          record,
          sapBindings: record.sapBindings && record.sapBindings.length ? record.sapBindings : [createSap()],
          itemList: mergeLegacyItems(record),
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
    const ii = e.currentTarget.dataset.itemIndex;
    const field = e.currentTarget.dataset.field;
    this.setData({ [`itemList[${ii}].${field}`]: e.detail.value });
  },
  addSap() { this.setData({ sapBindings: this.data.sapBindings.concat([createSap()]) }); },
  removeSap(e) {
    const index = Number(e.currentTarget.dataset.index);
    wx.showModal({
      title: '删除 SAP',
      content: '确认删除该 SAP号吗？',
      success: (res) => {
        if (!res.confirm) return;
        const list = this.data.sapBindings.slice();
        list.splice(index, 1);
        this.setData({ sapBindings: list.length ? list : [createSap()] });
      }
    });
  },
  addItem() {
    const list = this.data.itemList.slice();
    list.push(createItem(nextItemNo(list)));
    this.setData({ itemList: list });
  },
  removeItem(e) {
    const ii = Number(e.currentTarget.dataset.itemIndex);
    wx.showModal({
      title: '删除 Item',
      content: '确认删除该 Item 吗？',
      success: (res) => {
        if (!res.confirm) return;
        const list = this.data.itemList.slice();
        list.splice(ii, 1);
        this.setData({ itemList: list.length ? list : [createItem('1000')] });
      }
    });
  },
  validate() {
    const sapSeen = {};
    for (let i = 0; i < this.data.sapBindings.length; i++) {
      const sap = this.data.sapBindings[i];
      if (!String(sap.sapNo || '').trim()) return `第 ${i + 1} 个 SAP号为空`;
      if (sapSeen[sap.sapNo]) return `SAP号 ${sap.sapNo} 重复`;
      sapSeen[sap.sapNo] = true;
    }
    const itemSeen = {};
    for (let j = 0; j < this.data.itemList.length; j++) {
      const no = String(this.data.itemList[j].itemNo || '').trim();
      if (!no) return `第 ${j + 1} 个 Item号为空`;
      if (itemSeen[no]) return `Item号 ${no} 重复`;
      itemSeen[no] = true;
    }
    return '';
  },
  saveSap() {
    const msg = this.validate();
    if (msg) { wx.showToast({ title: msg, icon: 'none' }); return; }
    wx.showLoading({ title: '保存中' });
    precalService.callPrecalService('bindSap', { precalRecordId: this.data.id, sapBindings: this.data.sapBindings, itemList: this.data.itemList, reason: this.data.reason || '保存 SAP 绑定信息' })
      .then(() => { wx.showToast({ title: '已保存', icon: 'success' }); setTimeout(() => wx.navigateBack(), 500); })
      .catch(err => wx.showToast({ title: err.message || '保存失败', icon: 'none' }))
      .finally(() => wx.hideLoading());
  }
});

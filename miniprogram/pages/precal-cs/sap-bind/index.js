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
function dedupeItems(items) {
  const seen = {};
  return (items || []).filter(item => {
    const key = String(item.itemNo || '').trim();
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  });
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
          itemList: dedupeItems(
            record.itemList && record.itemList.length
              ? record.itemList
              : (record.sapBindings || []).reduce((acc, sap) => acc.concat(sap.items || []), [])
          ).length ? dedupeItems(
            record.itemList && record.itemList.length
              ? record.itemList
              : (record.sapBindings || []).reduce((acc, sap) => acc.concat(sap.items || []), [])
          ) : [createItem('1000')],
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
      title: '确认删除',
      content: '确定删除该 SAP 绑定吗？',
      success: (res) => {
        if (!res.confirm) return;
        const list = this.data.sapBindings.slice();
        list.splice(index, 1);
        this.setData({ sapBindings: list.length ? list : [createSap()] });
      }
    });
  },
  addItem() {
    const items = this.data.itemList.slice();
    items.push(createItem(nextItemNo(items)));
    this.setData({ itemList: items });
  },
  removeItem(e) {
    const ii = Number(e.currentTarget.dataset.itemIndex);
    wx.showModal({
      title: '确认删除',
      content: '确定删除该 Item 吗？',
      success: (res) => {
        if (!res.confirm) return;
        const items = this.data.itemList.slice();
        items.splice(ii, 1);
        this.setData({ itemList: items.length ? items : [createItem('1000')] });
      }
    });
  },
  validate() {
    const sapSeen = {};
    for (let i = 0; i < this.data.sapBindings.length; i++) {
      const sap = this.data.sapBindings[i];
      if (!String(sap.sapNo || '').trim()) return `第 ${i + 1} 个 SAP号为空`;
      const normalizedSap = String(sap.sapNo || '').trim();
      if (sapSeen[normalizedSap]) return `SAP号 ${normalizedSap} 重复`;
      sapSeen[normalizedSap] = true;
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

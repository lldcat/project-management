const precalService = require('../../../services/precalService');
const { formatMoney, formatPercent } = require('../../../utils/precalCalculator');

function createItem(itemNo) {
  return { itemId: `I${Date.now()}_${Math.floor(Math.random() * 100000)}`, itemNo, itemDescription: '', remark: '' };
}
function createSap() {
  return { sapId: `S${Date.now()}_${Math.floor(Math.random() * 100000)}`, sapOrderNo: '', sapNoText: '', itemNo: '1000', active: true, activeText: '有效', isActive: true, isInactive: false, source: 'manual', memberName: '', remark: '' };
}
function nextItemNo(items) {
  const nums = (items || []).map(item => parseInt(item.itemNo, 10)).filter(num => !isNaN(num));
  let next = 1000;
  while (nums.indexOf(next) >= 0) next += 1000;
  return String(next);
}
function normalizeItems(record) {
  const merged = [];
  const seen = {};

  const add = (raw) => {
    const itemNoRaw = String((raw && raw.itemNo) || '').trim();
    const itemNo = itemNoRaw || nextItemNo(merged);
    const itemDescription = String((raw && raw.itemDescription) || '').trim();
    const remark = String((raw && raw.remark) || '').trim();

    // Item号 应该唯一，所以按 itemNo 去重，而不是按 itemNo + 描述 + 备注去重
    if (seen[itemNo]) return;
    seen[itemNo] = true;

    merged.push({
      itemId: raw.itemId || `I${Date.now()}_${Math.floor(Math.random() * 100000)}`,
      itemNo,
      itemDescription,
      remark
    });
  };

  (record.itemList || []).forEach(add);

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
          record: Object.assign({}, record, {
            salesOwnerNameText: record.salesOwnerName || '-'
          }),
          sapBindings: this.normalizeSapBindings(record.sapBindings && record.sapBindings.length ? record.sapBindings : [createSap()]),
          itemList: normalizeItems(record),
          summary: { totalOrderValueText: formatMoney(r.totalOrderValue), operatingMarginText: formatPercent(r.operatingMargin) }
        });
      })
      .catch(err => wx.showToast({ title: err.message || '加载失败', icon: 'none' }));
  },
  normalizeSapBindings(list) {
    return (list || []).map(item => {
      const sapOrderNo = String(item.sapOrderNo || '').trim();
      return Object.assign({}, item, {
        sapOrderNo,
        itemNo: item.itemNo || (sapOrderNo.indexOf('7') === 0 ? '1000' : ''),
        active: item.active === false ? false : true,
        activeText: item.active === false ? '已停用' : '有效',
        isInactive: item.active === false,
        isActive: item.active !== false,
        sapNoText: sapOrderNo
      });
    });
  },
  onReasonInput(e) { this.setData({ reason: e.detail.value || '' }); },
  onSapInput(e) {
    const index = e.currentTarget.dataset.index;
    const field = e.currentTarget.dataset.field;
    const data = {};
    const value = e.detail.value;
    data['sapBindings[' + index + '].' + field] = value;
    if (field === 'sapOrderNo') {
      data['sapBindings[' + index + '].sapOrderNo'] = value;
      data['sapBindings[' + index + '].sapNoText'] = value;
      const current = this.data.sapBindings[index] || {};
      if (!current.itemNo && String(value || '').indexOf('7') === 0) data['sapBindings[' + index + '].itemNo'] = '1000';
    }
    this.setData(data);
  },
  onItemInput(e) {
    const ii = e.currentTarget.dataset.itemIndex;
    const field = e.currentTarget.dataset.field;
    const data = {};
    data['itemList[' + ii + '].' + field] = e.detail.value;
    this.setData(data);
  },
  addSap() { this.setData({ sapBindings: this.data.sapBindings.concat([createSap()]) }); },
  restoreSap(e) {
    const index = Number(e.currentTarget.dataset.index);
    const data = {};
    data['sapBindings[' + index + '].active'] = true;
    data['sapBindings[' + index + '].activeText'] = '有效';
    data['sapBindings[' + index + '].isInactive'] = false;
    data['sapBindings[' + index + '].isActive'] = true;
    data['sapBindings[' + index + '].disabledAt'] = null;
    data['sapBindings[' + index + '].disabledBy'] = null;
    data['sapBindings[' + index + '].disabledReason'] = null;
    this.setData(data);
  },
  removeSap(e) {
    const index = Number(e.currentTarget.dataset.index);
    wx.showModal({

      title: '删除 SAP',
      content: '确认删除该 SAP号吗？',

      success: (res) => {
        if (!res.confirm) return;
        const list = this.data.sapBindings.slice();
        const current = list[index] || {};
        if (current.sapOrderNo) {
          list[index] = Object.assign({}, current, {
            active: false,
            activeText: '已停用',
            isInactive: true,
            isActive: false,
            disabledReason: current.disabledReason || 'user_removed'
          });
        } else {
          list.splice(index, 1);
        }
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
      if (sap.active === false) continue;
      const normalizedSap = String(sap.sapOrderNo || '').trim();
      const itemNo = String(sap.itemNo || '').trim() || (normalizedSap.indexOf('7') === 0 ? '1000' : '');
      const key = `${normalizedSap}#${itemNo}`;

      if (!normalizedSap) return `第 ${i + 1} 个 SAP号为空`;
      if (sapSeen[key]) return `SAP号 ${normalizedSap} / Item ${itemNo || '空'} 重复`;

      sapSeen[key] = true;
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
  async saveSap() {
    const msg = this.validate();
    if (msg) { wx.showToast({ title: msg, icon: 'none' }); return; }

    let loadingShown = false;
    try {
      wx.showLoading({ title: '保存中' });
      loadingShown = true;
      await precalService.callPrecalService('bindSap', {
        precalRecordId: this.data.id,
        sapBindings: this.data.sapBindings,
        itemList: this.data.itemList,
        reason: this.data.reason || '保存 SAP 绑定信息'
      });
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (err) {
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
    } finally {
      if (loadingShown) wx.hideLoading();
    }
  }
});

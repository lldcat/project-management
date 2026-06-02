const precalService = require('../../../services/precalService');
const { formatMoney, formatPercent } = require('../../../utils/precalCalculator');

Page({
  data: {
    id: '',
    record: {},
    statusLabel: '',
    sapText: '',
    itemList: [],
    resultItems: [],
    scenario70: {},
    scenario80: {},
    showScenario: false,
    canEdit: false,
    canSubmit: false,
    sapBindings: [],
    hasSapBindings: false,
    hasItems: false,
    showScenarioText: '展开',
    statusTagClass: 'tag-warning'
  },

  onLoad(options) { this.setData({ id: options.id || '' }); this.loadData(); },
  onShow() { if (this.data.id) this.loadData(); },

  label(status) {
    const map = { Draft: '草稿', Submitted: '已提交', Withdrawn: '已撤销', 'SAP Bound': '已绑定SAP', Unlocked: '已解锁', Cancelled: '已取消' };
    return map[status] || status;
  },

  loadData() {
    return precalService.callPrecalService('getPrecalDetail', { precalRecordId: this.data.id })
      .then(res => {
        const record = res.record || {};
        const r = record.calculationResult || {};
        const s70 = (record.productivityScenarios || {}).productivity70 || {};
        const s80 = (record.productivityScenarios || {}).productivity80 || {};
        const user = res.user || {};
        const roles = user.roles || (user.role ? [user.role] : []);
        const editableStatuses = ['Draft', 'Withdrawn', 'Unlocked'];
        const canEdit = editableStatuses.indexOf(record.status) >= 0 && (record.createdBy === user.openid || roles.indexOf('admin') >= 0);
        const canSubmit = editableStatuses.indexOf(record.status) >= 0;
        const rawSapBindings = Array.isArray(record.sapBindings) ? record.sapBindings : [];
        const sapBindings = rawSapBindings.map(item => Object.assign({}, item, {
          memberNameText: item.memberName || '-',
          remarkText: item.remark || '-'
        }));
        const rawItemList = record.itemList && record.itemList.length ? record.itemList : sapBindings.reduce((acc, sap) => acc.concat(sap.items || []), []);
        const itemList = rawItemList.map(item => Object.assign({}, item, {
          itemNoText: item.itemNo || '-',
          itemDescriptionText: item.itemDescription || '-',
          remarkText: item.remark || '-'
        }));
        const lineItems = (record.lineItems || []).map(item => Object.assign({}, item, {
          productDescriptionText: item.productDescription || '未填写服务描述',
          operatingMarginText: formatPercent((item.calculated || {}).operatingMargin)
        }));
        this.setData({
          record: Object.assign({}, record, {
            lineItems,
            salesOwnerNameText: record.salesOwnerName || '-',
            remarkText: record.remark || '-'
          }),
          statusLabel: this.label(record.status),
          sapText: sapBindings.map(item => item.sapNo).join('、'),
          sapBindings,
          hasSapBindings: sapBindings.length > 0,
          itemList,
          hasItems: itemList.length > 0,
          canEdit,
          canSubmit,
          statusTagClass: record.status === 'SAP Bound' ? 'tag-normal' : 'tag-warning',
          showScenarioText: this.data.showScenario ? '收起' : '展开',
          resultItems: [
            { key: 'totalOrderValue', label: 'Total Order Value', value: formatMoney(r.totalOrderValue) },
            { key: 'totalMD', label: 'Total MD', value: r.totalMD || 0 },
            { key: 'totalHours', label: 'Hours', value: r.totalHours || 0 },
            { key: 'totalNetSales', label: 'Net Sales', value: formatMoney(r.totalNetSales) },
            { key: 'resultOfOrder', label: 'RO', value: formatMoney(r.resultOfOrder) },
            { key: 'roMargin', label: 'RO Margin', value: formatPercent(r.roMargin) },
            { key: 'overhead', label: 'Overhead', value: formatMoney(r.overhead) },
            { key: 'operatingResult', label: 'Operating Result', value: formatMoney(r.operatingResult) },
            { key: 'operatingMargin', label: 'Operating Margin', value: formatPercent(r.operatingMargin) },
            { key: 'plannedORSales', label: 'Planned OR/Sales', value: formatPercent(r.plannedORSales) }
          ],
          scenario70: { mdCostsText: s70.available ? formatMoney(s70.mdCosts) : '参数未维护', operatingMarginText: s70.available ? formatPercent(s70.operatingMargin) : '-' },
          scenario80: { mdCostsText: s80.available ? formatMoney(s80.mdCosts) : '参数未维护', operatingMarginText: s80.available ? formatPercent(s80.operatingMargin) : '-' }
        });
      })
      .catch(err => wx.showToast({ title: err.message || '加载失败', icon: 'none' }));
  },

  toggleScenario() {
    const showScenario = !this.data.showScenario;
    this.setData({
      showScenario,
      showScenarioText: showScenario ? '收起' : '展开'
    });
  },
  goEdit() { wx.navigateTo({ url: `/pages/precal/edit/index?id=${this.data.id}` }); },
  submit() {
    precalService.callPrecalService('submitPrecal', { precalRecordId: this.data.id })
      .then(() => { wx.showToast({ title: '已提交', icon: 'success' }); this.loadData(); })
      .catch(err => wx.showToast({ title: err.message || '提交失败', icon: 'none' }));
  },
  withdraw() {
    wx.showModal({ title: '撤销 Pre-cal', editable: true, placeholderText: '撤销原因', content: '撤销后 CS 将看不到该记录。', success: modal => {
      if (!modal.confirm) return;
      precalService.callPrecalService('withdrawPrecal', { precalRecordId: this.data.id, reason: modal.content || 'Sales 撤销修改' })
        .then(() => { wx.showToast({ title: '已撤销', icon: 'success' }); this.loadData(); })
        .catch(err => wx.showToast({ title: err.message || '撤销失败', icon: 'none' }));
    } });
  }
});

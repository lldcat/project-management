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
    inactiveSapBindings: [],
    hasSapBindings: false,
    hasInactiveSapBindings: false,
    hasItems: false,
    arTime: { totalArHoursText: '0', details: [], hasDetails: false },
    showArDetails: false,
    showArDetailsText: '展开',
    showScenarioText: '展开',
    statusTagClass: 'tag-warning'
  },

  onLoad(options) { this.setData({ id: options.id || '' }); this.loadData(); },
  onShow() { if (this.data.id) this.loadData(); },

  label(status) {
    const map = { Draft: '草稿', Submitted: '已提交', Withdrawn: '已撤销', 'SAP Bound': '已绑定SAP', 'Project Created': '已创建项目', Unlocked: '已解锁', Cancelled: '已取消' };
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
        const roles = Array.isArray(user.roles) ? user.roles : [];
        const editableStatuses = ['Draft', 'Withdrawn', 'Unlocked'];
        const canEdit = editableStatuses.indexOf(record.status) >= 0 && (record.createdBy === user.openid || roles.indexOf('admin') >= 0);
        const canSubmit = editableStatuses.indexOf(record.status) >= 0;
        const rawSapBindings = Array.isArray(record.sapBindings) ? record.sapBindings : [];
        const normalizedSapBindings = rawSapBindings.map(item => {
          const sapOrderNo = item.sapOrderNo || '';
          return Object.assign({}, item, {
            sapOrderNo,
            itemNo: item.itemNo || (String(sapOrderNo).indexOf('7') === 0 ? '1000' : ''),
            active: item.active === false ? false : true
          });
        });
        const sapBindings = normalizedSapBindings.filter(item => item.active !== false).map(item => Object.assign({}, item, {
          sapNoText: item.sapOrderNo || '-',
          memberNameText: item.memberName || '-',
          itemNoText: item.itemNo || '-',
          remarkText: item.remark || '-'
        }));
        const inactiveSapBindings = normalizedSapBindings.filter(item => item.active === false).map(item => Object.assign({}, item, {
          sapNoText: item.sapOrderNo || '-',
          memberNameText: item.memberName || '-',
          itemNoText: item.itemNo || '-',
          disabledReasonText: item.disabledReason || '-',
          remarkText: item.remark || '-'
        }));
        const rawItemList = record.itemList && record.itemList.length ? record.itemList : [];
        const itemList = rawItemList.map(item => Object.assign({}, item, {
          itemNoText: item.itemNo || '-',
          itemDescriptionText: item.itemDescription || '-',
          remarkText: item.remark || '-'
        }));
        const arTime = this.buildArTime(record.arTime);
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
          sapText: sapBindings.map(item => item.sapOrderNo).join('、'),
          sapBindings,
          hasSapBindings: sapBindings.length > 0,
          inactiveSapBindings,
          hasInactiveSapBindings: inactiveSapBindings.length > 0,
          itemList,
          hasItems: itemList.length > 0,
          arTime,
          canEdit,
          canSubmit,
          statusTagClass: record.status === 'SAP Bound' ? 'tag-normal' : 'tag-warning',
          showArDetailsText: this.data.showArDetails ? '收起' : '展开',
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

  buildArTime(raw) {
    const source = raw || {};
    const details = (source.details || []).map(item => Object.assign({}, item, {
      detailKey: `${item.employeeName || '-'}#${item.sapOrderNo || '-'}#${item.itemNo || '-'}`,
      employeeNameText: item.employeeName || '-',
      sapOrderNo: item.sapOrderNo || '-',
      itemNoText: item.itemNo || '-',
      totalArHoursText: this.formatHours(item.totalArHours),
      recordCountText: item.recordCount || 0
    }));
    return {
      sapOrderNos: source.sapOrderNos || [],
      sapText: (source.sapOrderNos || []).join('、'),
      sapDisplayText: (source.sapOrderNos || []).join('、') || '暂无 SAP号',
      warningText: source.warningText || '',
      noActiveSap: !!source.noActiveSap,
      totalArHoursText: this.formatHours(source.totalArHours),
      details,
      hasDetails: details.length > 0
    };
  },

  formatHours(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0';
    return String(Math.round(n * 100) / 100);
  },

  toggleArDetails() {
    const showArDetails = !this.data.showArDetails;
    this.setData({
      showArDetails,
      showArDetailsText: showArDetails ? '收起' : '展开'
    });
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

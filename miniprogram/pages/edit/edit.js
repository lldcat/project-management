const app = getApp();
const projectService = require('../../services/projectService');
const userService = require('../../services/userService');
const { formatMoney } = require('../../utils/metrics');
const { enrichProject } = require('../../utils/metrics');

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function normalizeName(name) {
  return String(name || '').trim();
}

function uniqueNames(names) {
  const result = [];
  const seen = {};
  (names || []).forEach(name => {
    const cleanName = normalizeName(name);
    if (!cleanName || seen[cleanName]) return;
    seen[cleanName] = true;
    result.push(cleanName);
  });
  return result;
}

function normalizeMembers(input) {
  const memberValue = item => {
    if (item && typeof item === 'object') return item.memberName || '';
    return item;
  };
  if (Array.isArray(input)) {
    return uniqueNames(input.map(memberValue).map(normalizeName));
  }
  if (typeof input === 'string') {
    return uniqueNames(input.split(/[、,，;；\n\r]+/).map(normalizeName));
  }
  if (input && typeof input === 'object') {
    return uniqueNames(Object.keys(input).map(normalizeName));
  }
  return [];
}

function toNullableNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toOptionalNumberValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' && value.trim() === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
}

function isInvalidNumber(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  const n = Number(value);
  return !Number.isFinite(n) || n < 0;
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function assignIfValue(target, field, value) {
  if (hasValue(value)) target[field] = value;
}

function firstValue(values) {
  for (const value of values || []) {
    if (hasValue(value)) return value;
  }
  return '';
}

function normalizeSapNo(value) {
  return String(value || '').trim();
}

function displayValue(value) {
  return hasValue(value) ? value : '-';
}

function buildPmDisplayName(form, fallbackName) {
  const data = form || {};
  return normalizeName(data.pmName || data.projectManager || fallbackName) || '请先在“我的”页填写姓名';
}

function buildAlertDisplay(alerts) {
  return (alerts || []).map(item => Object.assign({}, item, {
    statusClass: item.level === 'risk' ? 'tag-risk' : (item.level === 'warning' ? 'tag-warning' : 'tag-normal')
  }));
}

function buildPrecalDisplay(form) {
  const data = form || {};
  return {
    precalNo: displayValue(data.precalNo),
    service: displayValue(data.service),
    salesOwnerName: displayValue(data.salesOwnerName),
    sapText: displayValue((data.sapNumbers || []).join('、')),
    totalBudget: displayValue(data.precalProjectBudget || data.totalBudget || data.projectTotalBudget),
    budgetHours: displayValue(data.allocatableHours || data.budgetHours || data.budgetTotalHours),
    travelFee: displayValue(data.travelFee),
    operatingMargin: displayValue(data.operatingMargin)
  };
}

function buildSapBindingDisplay(form) {
  const rows = (Array.isArray(form && form.sapBindings) ? form.sapBindings : []).map(item => {
    const sapOrderNo = normalizeSapNo(item.sapOrderNo);
    return Object.assign({}, item, {
      sapOrderNo,
      itemNoText: item.itemNo || (sapOrderNo.indexOf('7') === 0 ? '1000' : '-'),
      memberNameText: item.memberName || '-',
      remarkText: item.remark || '-',
      disabledReasonText: item.disabledReason || '-',
      active: item.active === false ? false : true
    });
  }).filter(item => item.sapOrderNo);
  return {
    active: rows.filter(item => item.active !== false),
    inactive: rows.filter(item => item.active === false)
  };
}

function normalizeArDetails(input) {
  return (Array.isArray(input) ? input : []).map(item => ({
    detailKey: `${item.employeeName || '-'}#${item.sapOrderNo || '-'}#${item.itemNo || '-'}`,
    employeeName: item.employeeName || '-',
    sapOrderNo: item.sapOrderNo || '-',
    itemNo: item.itemNo || '-',
    totalArHours: item.totalArHours === undefined || item.totalArHours === null ? 0 : item.totalArHours,
    recordCount: item.recordCount || 0
  }));
}

function mapByName(rows, valueField) {
  const map = {};
  (rows || []).forEach(item => {
    const name = normalizeName(item.memberName);
    if (!name) return;
    map[name] = item[valueField] === undefined || item[valueField] === null ? '' : item[valueField];
  });
  return map;
}

function mapOpenidByName(rows) {
  const map = {};
  (rows || []).forEach(item => {
    const name = normalizeName(item.memberName);
    if (!name) return;
    map[name] = item.memberOpenid || '';
  });
  return map;
}

function normalizeWorkloadAllocations(project) {
  const data = project || {};
  const source = hasValue(data.employeeBudgets) ? data.employeeBudgets : [];
  const rows = [];

  const addRow = (name, budgetHours, id, memberOpenid) => {
    const memberName = normalizeName(name);
    if (!memberName) return;
    rows.push({
      id: id || createId('emp'),
      memberOpenid: memberOpenid || '',
      memberName,
      budgetHours: budgetHours === undefined || budgetHours === null ? '' : budgetHours
    });
  };

  if (Array.isArray(source)) {
    source.forEach(item => {
      if (typeof item === 'string') {
        addRow(item, '');
        return;
      }
      if (!item || typeof item !== 'object') return;
      addRow(
        item.memberName,
        item.budgetHours,
        item.id,
        item.memberOpenid
      );
    });
  }

  const budgetMap = mapByName(rows, 'budgetHours');
  const openidMap = mapOpenidByName(rows);
  return uniqueNames(rows.map(item => item.memberName)).map(name => {
    const existing = rows.find(item => normalizeName(item.memberName) === name) || {};
    return {
      id: existing.id || createId('emp'),
      memberOpenid: openidMap[name] || '',
      memberName: name,
      budgetHours: budgetMap[name] === undefined ? '' : budgetMap[name]
    };
  });
}

function normalizeArHourRows(input) {
  const rows = [];
  const addRow = (name, hours, id, meta) => {
    const memberName = normalizeName(name);
    if (!memberName) return;
    const extra = meta || {};
    rows.push({
      id: id || createId('ar'),
      memberName,
      memberOpenid: extra.memberOpenid || '',
      arSheetName: extra.arSheetName || '',
      source: extra.source || '',
      matchedSummaryCount: extra.matchedSummaryCount || 0,
      hours: hours === undefined || hours === null ? '' : hours
    });
  };

  if (Array.isArray(input)) {
    input.forEach(item => {
      if (typeof item === 'string') {
        addRow(item, '');
        return;
      }
      if (!item || typeof item !== 'object') return;
      addRow(
        item.memberName,
        item.hours,
        item.id,
        item
      );
    });
  } else if (typeof input === 'string') {
    normalizeMembers(input).forEach(name => addRow(name, ''));
  } else if (input && typeof input === 'object') {
    Object.keys(input).forEach(name => addRow(name, input[name]));
  }
  return rows;
}

function buildEmployeeBudgets(names, existingBudgets) {
  const budgetMap = mapByName(existingBudgets, 'budgetHours');
  const openidMap = mapOpenidByName(existingBudgets);
  return uniqueNames(names).map(name => ({
    id: ((existingBudgets || []).find(item => normalizeName(item.memberName) === name) || {}).id || createId('emp'),
    memberOpenid: openidMap[name] || '',
    memberName: name,
    budgetHours: budgetMap[name] === undefined ? '' : budgetMap[name]
  }));
}

function ensurePmInAllocation(form) {
  const data = form || {};
  const pmName = normalizeName(data.pmName || data.projectManager);
  const pmOpenid = data.pmOpenid || data.ownerOpenid || data.createdBy || '';
  const existing = normalizeWorkloadAllocations(data);
  if (!pmName) return applyEmployeeMeta(existing, data.projectManager);
  const hasPm = existing.some(item => normalizeName(item.memberName) === pmName);
  const next = hasPm ? existing.map(item => {
    if (normalizeName(item.memberName) !== pmName) return item;
    return Object.assign({}, item, { memberOpenid: item.memberOpenid || pmOpenid });
  }) : existing.concat({
    id: createId('emp'),
    memberOpenid: pmOpenid,
    memberName: pmName,
    budgetHours: ''
  });
  return applyEmployeeMeta(next, pmName);
}

function addMembersToAllocations(form, names) {
  const data = form || {};
  const cleanNames = normalizeMembers(names);
  if (!cleanNames.length) return data;
  const existing = normalizeWorkloadAllocations(data);
  const allocationNames = uniqueNames(existing.map(item => item.memberName).concat(cleanNames));
  const next = Object.assign({}, data);
  next.employeeBudgets = applyEmployeeMeta(buildEmployeeBudgets(allocationNames, existing), next.projectManager);
  next.arHours = data.arHours || [];
  return next;
}

function alignArHoursToEmployeeBudgets(employeeBudgets, existingArHours) {
  const arMap = mapByName(existingArHours, 'hours');
  return (employeeBudgets || [])
    .map(item => normalizeName(item.memberName))
    .filter(Boolean)
    .map(name => {
      const budget = (employeeBudgets || []).find(item => normalizeName(item.memberName) === name) || {};
      const existing = (existingArHours || []).find(item => normalizeName(item.memberName) === name) || {};
      return {
        id: existing.id || createId('ar'),
        memberName: name,
        memberOpenid: budget.memberOpenid || existing.memberOpenid || '',
        arSheetName: existing.arSheetName || '',
        source: existing.source || '',
        matchedSummaryCount: existing.matchedSummaryCount || 0,
        hours: arMap[name] === undefined ? '' : arMap[name]
      };
    });
}

function applyEmployeeMeta(employeeBudgets, projectManager) {
  const pmName = normalizeName(projectManager);
  return (employeeBudgets || []).map(item => {
    const isPm = !!pmName && normalizeName(item.memberName) === pmName;
    return Object.assign({}, item, {
      isPm,
      canRemove: !isPm
    });
  });
}

function normalizePeopleStructures(rawForm, options) {
  const form = JSON.parse(JSON.stringify(rawForm || {}));
  const includeArNames = !!(options && options.includeArNames);
  const pmName = normalizeName(form.projectManager);
  form.employeeBudgets = normalizeWorkloadAllocations(form);
  const employeeNames = form.employeeBudgets.map(item => item.memberName);
  const arRows = normalizeArHourRows(form.arHours);
  const arNames = includeArNames ? arRows.map(item => item.memberName) : [];
  const names = uniqueNames([pmName].concat(employeeNames, arNames));

  form.employeeBudgets = applyEmployeeMeta(buildEmployeeBudgets(names, form.employeeBudgets || []), pmName);
  form.arHours = arRows;
  return form;
}

function formatSummaryNumber(value) {
  if (value === null || value === undefined || value === '') return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function calculateAllocationSummary(project) {
  const form = project || {};
  const explicitBudgetHours = toOptionalNumberValue(form.allocatableHours !== undefined && form.allocatableHours !== ''
    ? form.allocatableHours
    : (form.budgetTotalHours !== undefined && form.budgetTotalHours !== '' ? form.budgetTotalHours : form.budgetHours));
  const workingMd = toOptionalNumberValue(form.workingMd);
  const projectBudgetHours = explicitBudgetHours !== ''
    ? Number(explicitBudgetHours)
    : (workingMd !== '' && Number.isFinite(Number(workingMd)) ? Number(workingMd) * 8 : '');
  const allocatedHours = (form.employeeBudgets || []).reduce((sum, item) => {
    const value = toOptionalNumberValue(item.budgetHours);
    const n = value === '' ? 0 : Number(value);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
  const hasProjectBudgetHours = projectBudgetHours !== '' && Number.isFinite(Number(projectBudgetHours));
  const remainingHours = hasProjectBudgetHours ? Number(projectBudgetHours) - allocatedHours : '';
  const allocationRatio = hasProjectBudgetHours && Number(projectBudgetHours) > 0 ? allocatedHours / Number(projectBudgetHours) : null;
  const overHours = hasProjectBudgetHours && remainingHours < 0 ? Math.abs(remainingHours) : 0;

  return {
    hasProjectBudgetHours,
    projectBudgetHours,
    allocatedHours,
    remainingHours,
    allocationRatio,
    overHours,
    isOverBudget: overHours > 0,
    projectBudgetHoursText: hasProjectBudgetHours ? formatSummaryNumber(projectBudgetHours) : '暂无可分配工时',
    allocatedHoursText: formatSummaryNumber(allocatedHours),
    remainingHoursText: hasProjectBudgetHours ? formatSummaryNumber(remainingHours) : '-',
    allocationRatioText: allocationRatio === null ? '-' : `${(allocationRatio * 100).toFixed(2)}%`,
    overHoursText: formatSummaryNumber(overHours)
  };
}

function buildMyAllocationDisplay(allocation) {
  const data = allocation || {};
  const hasBudgetHours = data.hasBudgetHours || data.budgetHours !== '';
  const hasActualHours = data.hasActualHours || data.actualHours !== '';
  return {
    memberName: data.memberName || '',
    hasBudgetHours,
    hasActualHours,
    budgetHoursText: hasBudgetHours ? `${formatSummaryNumber(data.budgetHours)} 小时` : '未分配',
    actualHoursText: hasActualHours ? `${formatSummaryNumber(data.actualHours)} 小时` : '',
    remainingHoursText: hasBudgetHours ? `${formatSummaryNumber(data.remainingHours)} 小时` : ''
  };
}

function normalizeArMemberCandidates(input) {
  return (Array.isArray(input) ? input : [])
    .map(item => {
      const matchStatus = item.matchStatus || '';
      return Object.assign({}, item, {
        candidateKey: `${item.memberOpenid || ''}#${item.memberName || ''}#${item.arSheetName || ''}`,
        sapText: (item.sapNumbers || []).join('、') || '-',
        hoursText: formatSummaryNumber(item.hours),
        matchedSummaryCountText: item.matchedSummaryCount || 0,
        statusClass: matchStatus === 'matched'
          ? 'tag-normal'
          : (matchStatus === 'alreadyMember' ? 'tag-warning' : 'tag-risk'),
        matchStatusText: item.matchStatusText || (matchStatus === 'matched'
          ? '可添加'
          : (matchStatus === 'alreadyMember' ? '已在项目组' : '需手动确认')),
        canAdd: !!item.canAdd && !!item.memberOpenid
      });
    })
    .filter(item => normalizeName(item.memberName));
}

function employeeBudgetNames(employeeBudgets) {
  return (employeeBudgets || []).map(item => normalizeName(item.memberName)).filter(Boolean).join('、');
}

function defaultForm() {
  return {
    projectName: '',
    customerName: '',
    projectNo: '',
    startDate: '',
    endDate: '',
    projectManager: '',
    pmOpenid: '',
    pmName: '',
    status: 'active',
    travelFee: '',
    clientName: '',
    sapNumbers: [],
    sapBindings: [],
    precalId: '',
    precalNo: '',
    service: '',
    salesOwnerName: '',
    orderValue: '',
    totalMd: '',
    workingMd: '',
    travelMd: '',
    quotationMd: '',
    allocatableHours: '',
    budgetTotalHours: '',
    budgetHours: '',
    precalProjectBudget: '',
    projectTotalBudget: '',
    totalBudget: '',
    operatingMargin: '',
    itemList: [],
    constants: {
      hoursPerDay: 8,
      personDayCost: 5000
    },
    subProjects: [
      { id: createId('sub'), name: '', itemNo: '1000', subProjectNo: '1000', budgetHours: '', travelFee: '', budgetLaborUnitPrice: 5000, plannedCompletedHours: '' }
    ],
    employeeBudgets: [],
    arHours: [],
    arDetails: [],
    arSummary: { totalArHours: 0, matchedSummaryCount: 0, latestUpdatedAt: '', latestUpdatedAtText: '' },
    arTimeWarning: '',
    arMemberCandidates: []
  };
}

Page({
  data: {
    id: '',
    isEdit: false,
    form: defaultForm(),
    membersText: '',
    memberInputText: '',
    currentUserName: '',
    currentUserOpenid: '',
    pmDisplayName: '请先在“我的”页填写姓名',
    missingUserName: false,
    statusIndex: 0,
    currentStatusLabel: '进行中',
    statusOptions: [
      { label: '进行中', value: 'active' },
      { label: '已完成', value: 'done' },
      { label: '暂停', value: 'paused' },
      { label: '风险关注', value: 'risk' }
    ],
    preview: enrichProject(defaultForm()),
    readOnly: false,
    pageTitle: '新增项目',
    sapSearchNo: '',
    precalPreview: null,
    precalSyncing: false,
    lastSyncedSapNo: '',
    precalSyncMessage: '',
    hasPrecalPreview: false,
    precalDisplay: buildPrecalDisplay(defaultForm()),
    activeSapBindings: [],
    inactiveSapBindings: [],
    hasActiveSapBindings: false,
    hasInactiveSapBindings: false,
    allocationSummary: calculateAllocationSummary(defaultForm()),
    detailLoading: false,
    canViewFullProject: true,
    canViewAllAllocations: true,
    myAllocationDisplay: buildMyAllocationDisplay(null),
    arMemberCandidates: [],
    hasArMemberCandidates: false,
    canAddArMemberCandidates: false
  },

  onLoad(options) {
    const id = options && options.id ? options.id : '';
    this.setData({ id, isEdit: !!id, pageTitle: id ? '编辑项目' : '新增项目', readOnly: false });
    this.initCurrentUser();
    if (id) {
      this.loadDetail(id);
    } else {
      this.applyCurrentUserToNewForm();
    }
  },

  onShow() {
    if (this.data.id && this.data.isEdit) this.loadDetail(this.data.id, { silent: true });
  },

  onPullDownRefresh() {
    const id = this.data.id;
    const task = id ? this.loadDetail(id, { silent: true }) : Promise.resolve();
    task.finally(() => wx.stopPullDownRefresh());
  },

  initCurrentUser() {
    const cached = app.globalData.user || {};
    if (cached.openid || app.globalData.openid) {
      this.applyCurrentUser(cached);
    }
    userService.login()
      .then(res => {
        const user = (res && res.user) || {};
        app.globalData.openid = (res && res.openid) || user.openid || app.globalData.openid || '';
        app.globalData.user = user;
        this.applyCurrentUser(user);
        if (!this.data.isEdit) this.applyCurrentUserToNewForm(user);
        if (!normalizeName(user.name)) this.promptUserName();
      })
      .catch(err => {
        console.error(err);
        wx.showToast({ title: '身份加载失败', icon: 'none' });
      });
  },

  applyCurrentUser(user) {
    const data = user || {};
    this.setData({
      currentUserName: normalizeName(data.name),
      currentUserOpenid: data.openid || app.globalData.openid || '',
      pmDisplayName: buildPmDisplayName(this.data.form, data.name),
      missingUserName: !normalizeName(data.name)
    });
  },

  promptUserName() {
    wx.showModal({
      title: '请先填写姓名',
      content: '项目 PM 名称将使用“我的”页面中的姓名，请填写后再创建项目。',
      showCancel: false,
      success: () => wx.switchTab({ url: '/pages/settings/settings' })
    });
  },

  applyCurrentUserToNewForm(user) {
    if (this.data.isEdit) return;
    const currentUser = user || app.globalData.user || {};
    const pmName = normalizeName(currentUser.name || this.data.currentUserName);
    const pmOpenid = currentUser.openid || this.data.currentUserOpenid || app.globalData.openid || '';
    let form = JSON.parse(JSON.stringify(this.data.form || defaultForm()));
    form.pmOpenid = pmOpenid;
    form.pmName = pmName;
    form.projectManager = pmName;
    form.employeeBudgets = ensurePmInAllocation(form);
    form.arHours = alignArHoursToEmployeeBudgets(form.employeeBudgets, form.arHours || []);
    this.setFormAndPreview(form);
  },

  loadDetail(id, options) {
    const opts = options || {};
    if (this.data.detailLoading) return Promise.resolve({ skipped: true });
    this.setData({ detailLoading: true });
    if (!opts.silent) wx.showLoading({ title: '加载中' });
    return projectService.getProjectDetail(id)
      .then(res => {
        const loaded = res.project || defaultForm();
        const readOnly = loaded._canEdit === false;
        const canViewFullProject = loaded._canViewFullProject !== false;
        const canViewAllAllocations = loaded._canViewAllAllocations !== false;
        const myAllocationDisplay = buildMyAllocationDisplay(loaded._myAllocation);
        let form = Object.assign(defaultForm(), loaded);
        form.pmName = form.pmName || form.projectManager || '';
        form.projectManager = form.pmName || form.projectManager || '';
        form.constants = Object.assign({ hoursPerDay: 8, personDayCost: 5000 }, loaded.constants || {});
        form.subProjects = (loaded.subProjects && loaded.subProjects.length ? loaded.subProjects : defaultForm().subProjects)
          .map(item => Object.assign({ id: createId('sub') }, item));
        form.employeeBudgets = normalizeWorkloadAllocations(loaded).map(item => Object.assign({ id: createId('emp') }, item));
        form.arHours = normalizeArHourRows(loaded.arHours).map(item => Object.assign({ id: createId('ar') }, item));
        form.arDetails = normalizeArDetails(loaded.arDetails);
        form.arSummary = Object.assign({ totalArHours: 0, matchedSummaryCount: 0, latestUpdatedAt: '', latestUpdatedAtText: '' }, loaded.arSummary || {});
        form.arTimeWarning = loaded.arTimeWarning || '';
        form.arMemberCandidates = normalizeArMemberCandidates(loaded.arMemberCandidates);
        form = normalizePeopleStructures(form, { includeArNames: false });
        if (readOnly) {
          form.employeeBudgets = (form.employeeBudgets || []).map(item => Object.assign({}, item, { canRemove: false }));
        }
        const statusIndex = this.data.statusOptions.findIndex(item => item.value === form.status);
        const sapDisplay = buildSapBindingDisplay(form);
        const arMemberCandidates = normalizeArMemberCandidates(loaded.arMemberCandidates);
        this.setData({
          form,
          pmDisplayName: buildPmDisplayName(form, this.data.currentUserName),
          activeSapBindings: sapDisplay.active,
          inactiveSapBindings: sapDisplay.inactive,
          hasActiveSapBindings: sapDisplay.active.length > 0,
          hasInactiveSapBindings: sapDisplay.inactive.length > 0,
          membersText: employeeBudgetNames(form.employeeBudgets),
          memberInputText: '',
          statusIndex: statusIndex >= 0 ? statusIndex : 0,
          currentStatusLabel: this.data.statusOptions[statusIndex >= 0 ? statusIndex : 0].label,
          readOnly,
          canViewFullProject,
          canViewAllAllocations,
          myAllocationDisplay,
          arMemberCandidates,
          hasArMemberCandidates: arMemberCandidates.length > 0,
          canAddArMemberCandidates: arMemberCandidates.some(item => item.canAdd),
          pageTitle: readOnly ? '查看项目' : '编辑项目'
        }, () => this.refreshPreview());
      })
      .catch(err => {
        console.error('[edit] 项目详情/AR Time 加载失败：', err);
        wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      })
      .finally(() => {
        this.setData({ detailLoading: false });
        if (!opts.silent) wx.hideLoading();
      });
  },

  setFormAndPreview(form) {
    const sapDisplay = buildSapBindingDisplay(form);
    this.setData({
      form,
      pmDisplayName: buildPmDisplayName(form, this.data.currentUserName),
      activeSapBindings: sapDisplay.active,
      inactiveSapBindings: sapDisplay.inactive,
      hasActiveSapBindings: sapDisplay.active.length > 0,
      hasInactiveSapBindings: sapDisplay.inactive.length > 0
    }, () => this.refreshPreview());
  },


  onSapInput(e) {
    const sapSearchNo = e.detail.value || '';
    this.setData({ sapSearchNo, precalSyncMessage: '' });
  },

  onManualSyncPrecal() {
    this.syncPrecalBySap({ force: true }).catch(err => {
      console.error('[edit] 手动同步 Pre-cal 失败：', err);
      wx.showToast({ title: err.message || '同步 Pre-cal 数据失败', icon: 'none' });
    });
  },

  applyPrecalToProjectForm(precalProject, sapNo) {
    const current = JSON.parse(JSON.stringify(this.data.form));
    const incoming = precalProject || {};
    const form = Object.assign({}, current);
    [
      'projectName', 'customerName', 'clientName', 'projectNo', 'precalId', 'precalNo',
      'service', 'salesOwnerName', 'orderValue', 'totalMd', 'workingMd', 'travelMd', 'quotationMd', 'allocatableHours', 'budgetTotalHours', 'budgetHours',
      'precalProjectBudget', 'projectTotalBudget', 'totalBudget', 'travelFee', 'operatingMargin'
    ].forEach(field => assignIfValue(form, field, incoming[field]));

    if (hasValue(incoming.sapNumbers)) form.sapNumbers = incoming.sapNumbers;
    if (hasValue(incoming.sapBindings)) form.sapBindings = incoming.sapBindings;
    if (hasValue(incoming.itemList)) form.itemList = incoming.itemList;
    if (hasValue(incoming.subProjects)) form.subProjects = incoming.subProjects.map(item => Object.assign({ id: createId('sub') }, item));
    if (hasValue(incoming.employeeBudgets)) form.employeeBudgets = normalizeWorkloadAllocations(incoming);
    form.arHours = hasValue(incoming.arHours) ? normalizeArHourRows(incoming.arHours) : [];
    form.arDetails = hasValue(incoming.arDetails) ? normalizeArDetails(incoming.arDetails) : [];
    form.arSummary = Object.assign(
      { totalArHours: 0, matchedSummaryCount: 0, latestUpdatedAt: '', latestUpdatedAtText: '' },
      incoming.arSummary || {}
    );
    form.arTimeWarning = incoming.arTimeWarning || '';
    form.arMemberCandidates = normalizeArMemberCandidates(incoming.arMemberCandidates);
    form.constants = Object.assign({ hoursPerDay: 8, personDayCost: 5000 }, current.constants || {}, incoming.constants || {});
    if (!this.data.isEdit) {
      const currentUser = app.globalData.user || {};
      form.pmOpenid = currentUser.openid || this.data.currentUserOpenid || '';
      form.pmName = normalizeName(currentUser.name || this.data.currentUserName);
      form.projectManager = form.pmName;
    }

    const normalized = normalizePeopleStructures(form, { includeArNames: false });
    const sapDisplay = buildSapBindingDisplay(normalized);
    const arMemberCandidates = normalizeArMemberCandidates(incoming.arMemberCandidates);
    this.setData({
      form: normalized,
      pmDisplayName: buildPmDisplayName(normalized, this.data.currentUserName),
      activeSapBindings: sapDisplay.active,
      inactiveSapBindings: sapDisplay.inactive,
      hasActiveSapBindings: sapDisplay.active.length > 0,
      hasInactiveSapBindings: sapDisplay.inactive.length > 0,
      membersText: employeeBudgetNames(normalized.employeeBudgets),
      memberInputText: '',
      sapSearchNo: normalizeSapNo(sapNo),
      precalPreview: incoming,
      hasPrecalPreview: true,
      precalDisplay: buildPrecalDisplay(normalized),
      arMemberCandidates,
      hasArMemberCandidates: arMemberCandidates.length > 0,
      canAddArMemberCandidates: arMemberCandidates.some(item => item.canAdd),
      lastSyncedSapNo: normalizeSapNo(sapNo),
      precalSyncMessage: '已同步 Pre-cal 数据'
    }, () => this.refreshPreview());
  },

  async syncPrecalBySap(options) {
    if (this.data.readOnly || this.data.isEdit) return { skipped: true };
    if (this.data.precalSyncing) return { skipped: true };
    const opts = options || {};
    const sapNo = normalizeSapNo(this.data.sapSearchNo);
    if (!sapNo) {
      const message = '请先输入 SAP 项目号';
      if (!opts.silent) wx.showToast({ title: message, icon: 'none' });
      return { skipped: true, message };
    }
    if (!opts.force && sapNo === this.data.lastSyncedSapNo) return { skipped: true };

    let loadingShown = false;
    this.setData({ precalSyncing: true, precalSyncMessage: '' });
    try {
      if (!opts.silent) {
        wx.showLoading({ title: '同步中' });
        loadingShown = true;
      }
      const res = await projectService.loadPrecalBySap(sapNo);
      this.applyPrecalToProjectForm(res.project || res.precal || {}, sapNo);
      if (loadingShown) {
        wx.hideLoading();
        loadingShown = false;
      }
      if (!opts.silent) wx.showToast({ title: '已同步 Pre-cal 数据', icon: 'success' });
      return res;
    } catch (err) {
      const message = err.message || '同步 Pre-cal 数据失败';
      this.setData({
        precalSyncMessage: message,
        precalPreview: null,
        hasPrecalPreview: false,
        lastSyncedSapNo: '',
        precalDisplay: buildPrecalDisplay(this.data.form),
        arMemberCandidates: [],
        hasArMemberCandidates: false,
        canAddArMemberCandidates: false
      });
      console.error('[edit] 同步 Pre-cal 数据失败：', err);
      if (loadingShown) {
        wx.hideLoading();
        loadingShown = false;
      }
      if (!opts.silent) wx.showToast({ title: message, icon: 'none' });
      if (opts.throwOnError) throw err;
      return { ok: false, message };
    } finally {
      this.setData({ precalSyncing: false });
      if (loadingShown) wx.hideLoading();
    }
  },

  onBasicInput(e) {
    if (this.data.readOnly) return;
    const field = e.currentTarget.dataset.field;
    let form = JSON.parse(JSON.stringify(this.data.form));
    form[field] = e.detail.value;
    this.setFormAndPreview(form);
  },

  onDateChange(e) {
    if (this.data.readOnly) return;
    const field = e.currentTarget.dataset.field;
    const data = {};
    data['form.' + field] = e.detail.value;
    this.setData(data, () => this.refreshPreview());
  },

  onMembersInput(e) {
    if (this.data.readOnly) return;
    const memberInputText = e.detail.value || '';
    this.setData({ memberInputText });
  },

  addMemberFromInput() {
    if (this.data.readOnly) return;
    const names = normalizeMembers(this.data.memberInputText);
    if (!names.length) return;
    let form = JSON.parse(JSON.stringify(this.data.form));
    form = addMembersToAllocations(form, names);
    this.setData({
      form,
      membersText: employeeBudgetNames(form.employeeBudgets),
      memberInputText: ''
    }, () => this.refreshPreview());
  },

  syncPeopleFromPmAndMembers() {
    if (this.data.readOnly) return;
    let form = JSON.parse(JSON.stringify(this.data.form));
    const names = uniqueNames([form.projectManager].concat((form.employeeBudgets || []).map(item => item.memberName)));
    if (!names.length) {
      wx.showToast({ title: '请先填写项目经理 PM 或项目组员', icon: 'none' });
      return;
    }
    form.employeeBudgets = applyEmployeeMeta(buildEmployeeBudgets(names, normalizeWorkloadAllocations(form)), form.projectManager);
    this.setFormAndPreview(form);
  },

  onStatusChange(e) {
    if (this.data.readOnly) return;
    const statusIndex = Number(e.detail.value);
    const status = this.data.statusOptions[statusIndex].value;
    this.setData({ statusIndex, currentStatusLabel: this.data.statusOptions[statusIndex].label, 'form.status': status });
  },

  onPersonDayCostInput(e) {
    if (this.data.readOnly) return;
    this.setData({ 'form.constants.personDayCost': e.detail.value }, () => this.refreshPreview());
  },

  onSubProjectInput(e) {
    if (this.data.readOnly) return;
    const index = e.currentTarget.dataset.index;
    const field = e.currentTarget.dataset.field;
    const data = {};
    data['form.subProjects[' + index + '].' + field] = e.detail.value;
    if (field === 'budgetLaborUnitPrice') {
      data['form.subProjects[' + index + '].budgetLaborUnitPriceRaw'] = e.detail.value;
    }
    this.setData(data, () => this.refreshPreview());
  },

  addSubProject() {
    if (this.data.readOnly) return;
    const subProjects = this.data.form.subProjects.concat({
      id: createId('sub'),
      name: '',
      itemNo: String((this.data.form.subProjects.length + 1) * 1000),
      subProjectNo: String((this.data.form.subProjects.length + 1) * 1000),
      budgetHours: '',
      travelFee: '',
      budgetLaborUnitPrice: 5000,
      plannedCompletedHours: ''
    });
    this.setData({ 'form.subProjects': subProjects }, () => this.refreshPreview());
  },

  removeSubProject(e) {
    if (this.data.readOnly) return;
    const index = Number(e.currentTarget.dataset.index);
    const subProjects = this.data.form.subProjects.filter((_, i) => i !== index);
    this.setData({ 'form.subProjects': subProjects.length ? subProjects : defaultForm().subProjects }, () => this.refreshPreview());
  },

  onEmployeeBudgetInput(e) {
    if (this.data.readOnly) return;
    const index = Number(e.currentTarget.dataset.index);
    const field = e.currentTarget.dataset.field;
    let form = JSON.parse(JSON.stringify(this.data.form));
    form.employeeBudgets[index][field] = e.detail.value;
    form.employeeBudgets = ensurePmInAllocation(form);
    this.setFormAndPreview(form);
  },

  addEmployeeBudget() {
    if (this.data.readOnly) return;
    let form = JSON.parse(JSON.stringify(this.data.form));
    form.employeeBudgets = (form.employeeBudgets || []).concat({ id: createId('emp'), memberName: '', budgetHours: '', isPm: false });
    this.setFormAndPreview(form);
  },

  removeEmployeeBudget(e) {
    if (this.data.readOnly) return;
    const index = Number(e.currentTarget.dataset.index);
    let form = JSON.parse(JSON.stringify(this.data.form));
    const item = form.employeeBudgets[index] || {};
    if (normalizeName(item.memberName) && normalizeName(item.memberName) === normalizeName(form.projectManager)) {
      wx.showToast({ title: 'PM 必须保留在人员预算和 AR 工时中', icon: 'none' });
      return;
    }
    form.employeeBudgets = (form.employeeBudgets || []).filter((_, i) => i !== index);
    this.setFormAndPreview(form);
  },

  addArMemberCandidate(e) {
    if (this.data.readOnly) return;
    const index = Number(e.currentTarget.dataset.index);
    const candidate = this.data.arMemberCandidates[index] || {};
    this.addArMembersFromCandidates([candidate]);
  },

  addAllArMemberCandidates() {
    if (this.data.readOnly) return;
    this.addArMembersFromCandidates((this.data.arMemberCandidates || []).filter(item => item.canAdd));
  },

  addArMembersFromCandidates(candidates) {
    const rows = (candidates || []).filter(item => item && item.canAdd && item.memberOpenid && normalizeName(item.memberName));
    if (!rows.length) {
      wx.showToast({ title: '没有可直接添加的 AR 人员', icon: 'none' });
      return;
    }
    let form = JSON.parse(JSON.stringify(this.data.form));
    const existingBudgets = normalizeWorkloadAllocations(form);
    const existingOpenids = {};
    const existingByName = {};
    existingBudgets.forEach(item => {
      if (item.memberOpenid) existingOpenids[item.memberOpenid] = true;
      if (normalizeName(item.memberName)) existingByName[normalizeName(item.memberName)] = item;
    });
    const addedNames = [];
    rows.forEach(item => {
      const name = normalizeName(item.memberName);
      if (existingOpenids[item.memberOpenid]) return;
      if (existingByName[name]) {
        if (!existingByName[name].memberOpenid) {
          existingByName[name].memberOpenid = item.memberOpenid;
          existingOpenids[item.memberOpenid] = true;
          addedNames.push(name);
        }
        return;
      }
      existingOpenids[item.memberOpenid] = true;
      existingBudgets.push({
        id: createId('emp'),
        memberOpenid: item.memberOpenid,
        memberName: name,
        budgetHours: ''
      });
      existingByName[name] = existingBudgets[existingBudgets.length - 1];
      addedNames.push(name);
    });
    if (!addedNames.length) {
      wx.showToast({ title: '候选人员已在项目组', icon: 'none' });
      return;
    }
    form.employeeBudgets = applyEmployeeMeta(existingBudgets, form.projectManager);
    const arMemberCandidates = normalizeArMemberCandidates(this.data.arMemberCandidates).map(item => {
      if (addedNames.indexOf(normalizeName(item.memberName)) < 0) return item;
      return Object.assign({}, item, {
        matchStatus: 'alreadyMember',
        matchStatusText: '已在项目组',
        statusClass: 'tag-warning',
        canAdd: false
      });
    });
    this.setData({
      form,
      membersText: employeeBudgetNames(form.employeeBudgets),
      arMemberCandidates,
      hasArMemberCandidates: arMemberCandidates.length > 0,
      canAddArMemberCandidates: arMemberCandidates.some(item => item.canAdd)
    }, () => this.refreshPreview());
  },

  refreshPreview() {
    const normalizedForm = Object.assign({}, this.data.form, {
      employeeBudgets: ensurePmInAllocation(this.data.form)
    });
    const preview = enrichProject(normalizedForm);
    preview.metrics = Object.assign({}, preview.metrics || {}, {
      alerts: buildAlertDisplay((preview.metrics || {}).alerts)
    });
    this.setData({ preview, allocationSummary: calculateAllocationSummary(normalizedForm) });
  },

  validateForm() {
    const form = this.data.form;
    if (!form.projectName && !form.projectNo) {
      wx.showToast({ title: '请填写项目名称或项目号', icon: 'none' });
      return false;
    }
    const userName = normalizeName((app.globalData.user && app.globalData.user.name) || this.data.currentUserName || form.pmName || form.projectManager);
    if (!userName) {
      wx.showToast({ title: '请先在“我的”页填写姓名', icon: 'none' });
      return false;
    }
    if (!form.subProjects || !form.subProjects.length) {
      wx.showToast({ title: '请至少填写一个子项目', icon: 'none' });
      return false;
    }
    for (let i = 0; i < (form.employeeBudgets || []).length; i++) {
      if (isInvalidNumber(form.employeeBudgets[i].budgetHours)) {
        wx.showToast({ title: `第 ${i + 1} 个人员预算工时需为非负数字`, icon: 'none' });
        return false;
      }
    }
    return true;
  },

  normalizeForm() {
    let form = JSON.parse(JSON.stringify(this.data.form));
    const currentUser = app.globalData.user || {};
    const pmName = normalizeName(currentUser.name || this.data.currentUserName || form.pmName || form.projectManager);
    const pmOpenid = currentUser.openid || this.data.currentUserOpenid || form.pmOpenid || '';
    form.pmOpenid = pmOpenid;
    form.pmName = pmName;
    form.projectManager = pmName;
    form = normalizePeopleStructures(form);
    form.travelFee = toNullableNumber(form.travelFee);
    form.orderValue = toNullableNumber(form.orderValue);
    form.totalMd = toNullableNumber(form.totalMd);
    form.workingMd = toNullableNumber(form.workingMd);
    form.travelMd = toNullableNumber(form.travelMd);
    form.quotationMd = toNullableNumber(form.quotationMd);
    form.allocatableHours = toNullableNumber(form.allocatableHours);
    form.budgetTotalHours = toNullableNumber(form.budgetTotalHours || form.budgetHours || form.allocatableHours);
    form.budgetHours = toNullableNumber(form.budgetHours || form.budgetTotalHours || form.allocatableHours);
    form.precalProjectBudget = toNullableNumber(firstValue([form.precalProjectBudget, form.projectTotalBudget, form.totalBudget]));
    form.projectTotalBudget = toNullableNumber(firstValue([form.projectTotalBudget, form.totalBudget, form.precalProjectBudget]));
    form.totalBudget = toNullableNumber(firstValue([form.totalBudget, form.projectTotalBudget, form.precalProjectBudget]));
    form.bac = null;
    form.operatingMargin = toNullableNumber(form.operatingMargin);
    form.clientName = form.clientName || form.customerName;
    form.sapBindings = (Array.isArray(form.sapBindings) ? form.sapBindings : [])
      .map(item => {
        const sapOrderNo = normalizeSapNo(item.sapOrderNo);
        return {
          sapId: item.sapId || item.id || createId('sap'),
          sapOrderNo,
          itemNo: String(item.itemNo || (sapOrderNo.indexOf('7') === 0 ? '1000' : '')).trim(),
          active: item.active === false ? false : true,
          source: item.source || 'manual',
          memberName: normalizeName(item.memberName),
          remark: String(item.remark || '').trim()
        };
      })
      .filter(item => item.sapOrderNo);
    form.sapNumbers = form.sapBindings.filter(item => item.active !== false).map(item => item.sapOrderNo);
    form.itemList = (Array.isArray(form.itemList) ? form.itemList : []).map(item => ({
      itemId: item.itemId || item.id || createId('item'),
      itemNo: String(item.itemNo || '').trim(),
      itemDescription: String(item.itemDescription || '').trim(),
      name: String(item.name || item.itemDescription || '').trim(),
      travelFee: toNullableNumber(item.travelFee),
      workingMd: toNullableNumber(item.workingMd),
      budgetHours: toNullableNumber(item.budgetHours),
      budgetAmount: toNullableNumber(item.budgetAmount),
      remark: String(item.remark || '').trim()
    })).filter(item => item.itemNo);
    form.constants = {
      hoursPerDay: 8,
      personDayCost: Number((form.constants && form.constants.personDayCost) || 5000)
    };
    form.subProjects = (form.subProjects || []).map(item => ({
      id: item.id || createId('sub'),
      name: item.name || '',
      subProjectNo: String(item.subProjectNo || item.itemNo || '').trim(),
      itemNo: String(item.itemNo || '').trim(),
      itemDescription: String(item.itemDescription || '').trim(),
      workingMd: toNullableNumber(item.workingMd),
      allocatableHours: toNullableNumber(item.allocatableHours),
      budgetHours: toNullableNumber(item.budgetHours),
      travelFee: toNullableNumber(item.travelFee),
      budgetLaborUnitPriceRaw: toNullableNumber(item.budgetLaborUnitPriceRaw),
      budgetLaborUnitPrice: toNullableNumber(item.budgetLaborUnitPrice),
      plannedCompletedHours: toNullableNumber(item.plannedCompletedHours)
    }));
    form.employeeBudgets = (form.employeeBudgets || [])
      .filter(item => normalizeName(item.memberName))
      .map(item => ({
        id: item.id || createId('emp'),
        memberOpenid: item.memberOpenid || '',
        memberName: normalizeName(item.memberName),
        budgetHours: toOptionalNumberValue(item.budgetHours)
      }));
    delete form.arHours;
    delete form.arDetails;
    delete form.arSummary;
    delete form.arTimeWarning;
    delete form.arMemberCandidates;
    return form;
  },

  async saveProject() {
    if (this.data.readOnly) {
      wx.showToast({ title: '当前项目为只读', icon: 'none' });
      return;
    }

    const form = this.data.form || {};
    const sapNo = normalizeSapNo(this.data.sapSearchNo);
    const needPrecalSync = !this.data.id && sapNo && (!form.precalNo || sapNo !== this.data.lastSyncedSapNo);
    if (needPrecalSync) {
      try {
        await this.syncPrecalBySap({ force: true, silent: true, throwOnError: true });
      } catch (err) {
        wx.showToast({ title: err.message || '未找到该 SAP 项目号对应的 Pre-cal', icon: 'none' });
        return;
      }
    }

    if (!this.validateForm()) return;
    const project = this.normalizeForm();
    console.log('before save employeeBudgets', project.employeeBudgets);
    let loadingShown = false;
    try {
      wx.showLoading({ title: '保存中' });
      loadingShown = true;
      const res = await projectService.saveProject(this.data.id, project);
      if (!this.data.id && res.id) {
        this.setData({ id: res.id, isEdit: true });
      }
      wx.showToast({ title: '已保存', icon: 'success' });
      if (res.id || this.data.id) this.loadDetail(res.id || this.data.id, { silent: true });
    } catch (err) {
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
    } finally {
      if (loadingShown) wx.hideLoading();
    }
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/projects/projects' })
    });
  }
});

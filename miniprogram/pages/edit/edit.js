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
    if (item && typeof item === 'object') return item.memberName || item.name || item.employeeName || item.userName || '';
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
    mainSapNo: displayValue(data.mainSapNo || data.projectNo),
    totalBudget: displayValue(data.precalProjectBudget || data.totalBudget || data.projectTotalBudget),
    budgetHours: displayValue(data.allocatableHours || data.budgetHours || data.budgetTotalHours),
    travelCost: displayValue(data.travelCost || data.travelFee),
    operatingMargin: displayValue(data.operatingMargin)
  };
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
    map[name] = item.memberOpenid || item.openid || '';
  });
  return map;
}

function normalizeWorkloadAllocations(project) {
  const data = project || {};
  const source = hasValue(data.employeeBudgets) ? data.employeeBudgets
    : (hasValue(data.memberBudgets) ? data.memberBudgets
      : (hasValue(data.workloadAllocations) ? data.workloadAllocations
        : (hasValue(data.budgetHoursAllocation) ? data.budgetHoursAllocation : [])));
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
        item.memberName || item.name || item.employeeName || item.userName,
        item.budgetHours !== undefined ? item.budgetHours
          : (item.hours !== undefined ? item.hours
            : (item.allocationHours !== undefined ? item.allocationHours : item.workload)),
        item.id,
        item.memberOpenid || item.openid
      );
    });
  } else if (typeof source === 'string') {
    normalizeMembers(source).forEach(name => addRow(name, ''));
  } else if (source && typeof source === 'object') {
    Object.keys(source).forEach(name => addRow(name, source[name]));
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
  const addRow = (name, hours, id) => {
    const memberName = normalizeName(name);
    if (!memberName) return;
    rows.push({
      id: id || createId('ar'),
      memberName,
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
        item.memberName || item.name || item.employeeName || item.userName,
        item.hours !== undefined ? item.hours : item.actualHours,
        item.id
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
  const next = Object.assign({}, data, {
    projectMembers: uniqueNames(normalizeMembers(data.projectMembers).concat(cleanNames))
  });
  next.employeeBudgets = applyEmployeeMeta(buildEmployeeBudgets(allocationNames, existing), next.projectManager);
  next.arHours = alignArHoursToEmployeeBudgets(next.employeeBudgets, data.arHours || []);
  return next;
}

function alignArHoursToEmployeeBudgets(employeeBudgets, existingArHours) {
  const arMap = mapByName(existingArHours, 'hours');
  return (employeeBudgets || [])
    .map(item => normalizeName(item.memberName))
    .filter(Boolean)
    .map(name => ({
      id: ((existingArHours || []).find(item => normalizeName(item.memberName) === name) || {}).id || createId('ar'),
      memberName: name,
      hours: arMap[name] === undefined ? '' : arMap[name]
    }));
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
  const memberNames = normalizeMembers(form.projectMembers);
  form.employeeBudgets = normalizeWorkloadAllocations(form);
  const employeeNames = form.employeeBudgets.map(item => item.memberName);
  const arRows = normalizeArHourRows(form.arHours);
  const arNames = includeArNames ? arRows.map(item => item.memberName) : [];
  const names = uniqueNames([pmName].concat(memberNames, employeeNames, arNames));

  form.employeeBudgets = applyEmployeeMeta(buildEmployeeBudgets(names, form.employeeBudgets || []), pmName);
  form.arHours = alignArHoursToEmployeeBudgets(form.employeeBudgets, arRows);
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
  const workingMd = toOptionalNumberValue(form.workingMD !== undefined && form.workingMD !== '' ? form.workingMD : form.workingMd);
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
    projectMembers: [],
    status: 'active',
    travelFee: '',
    clientName: '',
    mainSapNo: '',
    sapNumbers: [],
    sapBindings: [],
    precalId: '',
    precalNo: '',
    service: '',
    salesOwnerName: '',
    orderValue: '',
    totalMD: '',
    workingMD: '',
    workingMd: '',
    travelMD: '',
    quotationMD: '',
    allocatableHours: '',
    budgetTotalHours: '',
    budgetHours: '',
    precalProjectBudget: '',
    projectTotalBudget: '',
    totalBudget: '',
    travelCost: '',
    operatingMargin: '',
    itemList: [],
    constants: {
      hoursPerDay: 8,
      personDayCost: 5000
    },
    subProjects: [
      { id: createId('sub'), name: '', itemNo: '1000', subProjectNo: '1000', budgetHours: '', travelFee: '', travelCost: '', travelExpense: '', budgetLaborUnitPrice: 5000, plannedCompletedHours: '' }
    ],
    employeeBudgets: [],
    arHours: []
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
    allocationSummary: calculateAllocationSummary(defaultForm())
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

  loadDetail(id) {
    wx.showLoading({ title: '加载中' });
    projectService.getProjectDetail(id)
      .then(res => {
        const loaded = res.project || defaultForm();
        const readOnly = loaded._canEdit === false;
        let form = Object.assign(defaultForm(), loaded);
        form.pmName = form.pmName || form.projectManager || '';
        form.projectManager = form.pmName || form.projectManager || '';
        form.constants = Object.assign({ hoursPerDay: 8, personDayCost: 5000 }, loaded.constants || {});
        form.subProjects = (loaded.subProjects && loaded.subProjects.length ? loaded.subProjects : defaultForm().subProjects)
          .map(item => Object.assign({ id: createId('sub') }, item));
        form.employeeBudgets = normalizeWorkloadAllocations(loaded).map(item => Object.assign({ id: createId('emp') }, item));
        form.arHours = normalizeArHourRows(loaded.arHours).map(item => Object.assign({ id: createId('ar') }, item));
        form = normalizePeopleStructures(form, { includeArNames: true });
        if (readOnly) {
          form.employeeBudgets = (form.employeeBudgets || []).map(item => Object.assign({}, item, { canRemove: false }));
        }
        const statusIndex = this.data.statusOptions.findIndex(item => item.value === form.status);
        this.setData({
          form,
          pmDisplayName: buildPmDisplayName(form, this.data.currentUserName),
          membersText: normalizeMembers(form.projectMembers).join('、'),
          memberInputText: '',
          statusIndex: statusIndex >= 0 ? statusIndex : 0,
          currentStatusLabel: this.data.statusOptions[statusIndex >= 0 ? statusIndex : 0].label,
          readOnly,
          pageTitle: readOnly ? '查看项目' : '编辑项目'
        }, () => this.refreshPreview());
      })
      .catch(err => wx.showToast({ title: err.message || '加载失败', icon: 'none' }))
      .finally(() => wx.hideLoading());
  },

  setFormAndPreview(form) {
    this.setData({ form, pmDisplayName: buildPmDisplayName(form, this.data.currentUserName) }, () => this.refreshPreview());
  },


  onSapInput(e) {
    const sapSearchNo = e.detail.value || '';
    this.setData({ sapSearchNo, precalSyncMessage: '' });
  },

  onSapBlur() {
    this.syncPrecalBySap();
  },

  onSapConfirm() {
    this.syncPrecalBySap();
  },

  onManualSyncPrecal() {
    this.syncPrecalBySap({ force: true });
  },

  applyPrecalToProjectForm(precalProject, sapNo) {
    const current = JSON.parse(JSON.stringify(this.data.form));
    const incoming = precalProject || {};
    const form = Object.assign({}, current);
    [
      'projectName', 'customerName', 'clientName', 'projectNo', 'mainSapNo', 'precalId', 'precalNo',
      'service', 'salesOwnerName', 'orderValue', 'totalMD', 'workingMD', 'workingMd', 'travelMD', 'quotationMD', 'allocatableHours', 'budgetTotalHours', 'budgetHours',
      'precalProjectBudget', 'projectTotalBudget', 'totalBudget', 'travelFee', 'travelCost', 'operatingMargin'
    ].forEach(field => assignIfValue(form, field, incoming[field]));

    if (hasValue(incoming.sapNumbers)) form.sapNumbers = incoming.sapNumbers;
    if (hasValue(incoming.sapBindings)) form.sapBindings = incoming.sapBindings;
    if (hasValue(incoming.itemList)) form.itemList = incoming.itemList;
    if (hasValue(incoming.subProjects)) form.subProjects = incoming.subProjects.map(item => Object.assign({ id: createId('sub') }, item));
    if (hasValue(incoming.projectMembers)) form.projectMembers = normalizeMembers(incoming.projectMembers);
    if (hasValue(incoming.employeeBudgets)) form.employeeBudgets = normalizeWorkloadAllocations(incoming);
    if (hasValue(incoming.arHours)) form.arHours = incoming.arHours;
    form.constants = Object.assign({ hoursPerDay: 8, personDayCost: 5000 }, current.constants || {}, incoming.constants || {});
    if (!this.data.isEdit) {
      const currentUser = app.globalData.user || {};
      form.pmOpenid = currentUser.openid || this.data.currentUserOpenid || '';
      form.pmName = normalizeName(currentUser.name || this.data.currentUserName);
      form.projectManager = form.pmName;
    }

    const normalized = normalizePeopleStructures(form, { includeArNames: true });
    this.setData({
      form: normalized,
      pmDisplayName: buildPmDisplayName(normalized, this.data.currentUserName),
      membersText: normalizeMembers(normalized.projectMembers).join('、'),
      memberInputText: '',
      sapSearchNo: normalizeSapNo(sapNo || incoming.mainSapNo || incoming.projectNo),
      precalPreview: incoming,
      hasPrecalPreview: true,
      precalDisplay: buildPrecalDisplay(normalized),
      lastSyncedSapNo: normalizeSapNo(sapNo || incoming.mainSapNo || incoming.projectNo),
      precalSyncMessage: '已同步 Pre-cal 数据'
    }, () => this.refreshPreview());
  },

  async syncPrecalBySap(options) {
    if (this.data.readOnly || this.data.isEdit) return { skipped: true };
    const opts = options || {};
    const sapNo = normalizeSapNo(this.data.sapSearchNo || this.data.form.projectNo || this.data.form.mainSapNo || this.data.form.sapNo);
    if (!sapNo) return { skipped: true };
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
      if (!opts.silent) wx.showToast({ title: '已同步 Pre-cal 数据', icon: 'success' });
      return res;
    } catch (err) {
      const message = err.message || '同步 Pre-cal 数据失败';
      this.setData({
        precalSyncMessage: message,
        precalPreview: null,
        hasPrecalPreview: false,
        lastSyncedSapNo: '',
        precalDisplay: buildPrecalDisplay(this.data.form)
      });
      if (!opts.silent) wx.showToast({ title: message, icon: 'none' });
      throw err;
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
      membersText: normalizeMembers(form.projectMembers).join('、'),
      memberInputText: ''
    }, () => this.refreshPreview());
  },

  syncPeopleFromPmAndMembers() {
    if (this.data.readOnly) return;
    let form = JSON.parse(JSON.stringify(this.data.form));
    const names = uniqueNames([form.projectManager].concat(form.projectMembers || []));
    if (!names.length) {
      wx.showToast({ title: '请先填写项目经理 PM 或项目组员', icon: 'none' });
      return;
    }
    form.employeeBudgets = applyEmployeeMeta(buildEmployeeBudgets(names, normalizeWorkloadAllocations(form)), form.projectManager);
    form.arHours = alignArHoursToEmployeeBudgets(form.employeeBudgets, form.arHours || []);
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
      travelCost: '',
      travelExpense: '',
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
    form.arHours = alignArHoursToEmployeeBudgets(form.employeeBudgets, form.arHours || []);
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
    form.arHours = alignArHoursToEmployeeBudgets(form.employeeBudgets, form.arHours || []);
    this.setFormAndPreview(form);
  },

  onArHourInput(e) {
    if (this.data.readOnly) return;
    const index = e.currentTarget.dataset.index;
    const data = {};
    data['form.arHours[' + index + '].hours'] = e.detail.value;
    this.setData(data, () => this.refreshPreview());
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
    form.travelCost = toNullableNumber(form.travelCost || form.travelFee);
    form.orderValue = toNullableNumber(form.orderValue);
    form.totalMD = toNullableNumber(form.totalMD);
    form.workingMD = toNullableNumber(form.workingMD || form.workingMd);
    form.workingMd = toNullableNumber(form.workingMd || form.workingMD);
    form.travelMD = toNullableNumber(form.travelMD);
    form.quotationMD = toNullableNumber(form.quotationMD);
    form.allocatableHours = toNullableNumber(form.allocatableHours);
    form.budgetTotalHours = toNullableNumber(form.budgetTotalHours || form.budgetHours || form.allocatableHours);
    form.budgetHours = toNullableNumber(form.budgetHours || form.budgetTotalHours || form.allocatableHours);
    form.precalProjectBudget = toNullableNumber(firstValue([form.precalProjectBudget, form.projectTotalBudget, form.totalBudget]));
    form.projectTotalBudget = toNullableNumber(firstValue([form.projectTotalBudget, form.totalBudget, form.precalProjectBudget]));
    form.totalBudget = toNullableNumber(firstValue([form.totalBudget, form.projectTotalBudget, form.precalProjectBudget]));
    form.bac = null;
    form.operatingMargin = toNullableNumber(form.operatingMargin);
    form.clientName = form.clientName || form.customerName;
    form.mainSapNo = form.mainSapNo || form.projectNo;
    form.sapNumbers = Array.isArray(form.sapNumbers) ? form.sapNumbers.map(normalizeSapNo).filter(Boolean) : [];
    form.sapBindings = Array.isArray(form.sapBindings) ? form.sapBindings : [];
    form.itemList = Array.isArray(form.itemList) ? form.itemList : [];
    form.constants = {
      hoursPerDay: 8,
      personDayCost: Number((form.constants && form.constants.personDayCost) || 5000)
    };
    form.projectMembers = normalizeMembers(form.projectMembers);
    form.subProjects = (form.subProjects || []).map(item => ({
      id: item.id || createId('sub'),
      name: item.name || '',
      sapNo: normalizeSapNo(item.sapNo || item.sapProjectNo),
      sapProjectNo: normalizeSapNo(item.sapProjectNo || item.sapNo),
      subProjectNo: String(item.subProjectNo || item.itemNo || '').trim(),
      itemNo: String(item.itemNo || '').trim(),
      itemDescription: String(item.itemDescription || '').trim(),
      workingMD: toNullableNumber(item.workingMD || item.workingMd),
      workingMd: toNullableNumber(item.workingMd || item.workingMD),
      allocatableHours: toNullableNumber(item.allocatableHours),
      budgetHours: toNullableNumber(item.budgetHours),
      travelFee: toNullableNumber(item.travelFee || item.travelCost || item.travelExpense),
      travelCost: toNullableNumber(item.travelCost || item.travelFee || item.travelExpense),
      travelExpense: toNullableNumber(item.travelExpense || item.travelFee || item.travelCost),
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
    form.arHours = alignArHoursToEmployeeBudgets(form.employeeBudgets, form.arHours || [])
      .map(item => ({
        id: item.id || createId('ar'),
        memberName: normalizeName(item.memberName),
        hours: toNullableNumber(item.hours)
      }));
    return form;
  },

  async saveProject() {
    if (this.data.readOnly) {
      wx.showToast({ title: '当前项目为只读', icon: 'none' });
      return;
    }

    const form = this.data.form || {};
    const sapNo = normalizeSapNo(this.data.sapSearchNo || form.projectNo || form.mainSapNo || form.sapNo);
    const needPrecalSync = !this.data.id && sapNo && (!form.precalNo || sapNo !== this.data.lastSyncedSapNo);
    if (needPrecalSync) {
      try {
        await this.syncPrecalBySap({ force: true, silent: true });
      } catch (err) {
        wx.showToast({ title: err.message || '未找到该 SAP 项目号对应的 Pre-cal', icon: 'none' });
        return;
      }
    }

    if (!this.validateForm()) return;
    const project = this.normalizeForm();
    let loadingShown = false;
    try {
      wx.showLoading({ title: '保存中' });
      loadingShown = true;
      const res = await projectService.saveProject(this.data.id, project);
      if (!this.data.id && res.id) {
        this.setData({ id: res.id, isEdit: true });
      }
      wx.showToast({ title: '已保存', icon: 'success' });
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

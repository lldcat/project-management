const projectService = require('../../services/projectService');
const { formatMoney } = require('../../utils/metrics');
const { enrichProject } = require('../../utils/metrics');

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function normalizeName(name) {
  return String(name || '').trim();
}

function parseMembersText(text) {
  return String(text || '')
    .split(/[、,，\s\n]+/)
    .map(item => item.trim())
    .filter(Boolean);
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

function toNullableNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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

function normalizeSapNo(value) {
  return String(value || '').trim();
}

function displayValue(value) {
  return hasValue(value) ? value : '-';
}

function buildPrecalDisplay(form) {
  const data = form || {};
  return {
    precalNo: displayValue(data.precalNo),
    service: displayValue(data.service),
    salesOwnerName: displayValue(data.salesOwnerName),
    mainSapNo: displayValue(data.mainSapNo || data.projectNo),
    totalBudget: displayValue(data.totalBudget),
    budgetHours: displayValue(data.budgetHours || data.budgetTotalHours),
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

function buildEmployeeBudgets(names, existingBudgets) {
  const budgetMap = mapByName(existingBudgets, 'budgetHours');
  return uniqueNames(names).map(name => ({
    id: ((existingBudgets || []).find(item => normalizeName(item.memberName) === name) || {}).id || createId('emp'),
    memberName: name,
    budgetHours: budgetMap[name] === undefined ? '' : budgetMap[name]
  }));
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
  const memberNames = Array.isArray(form.projectMembers) ? form.projectMembers : [];
  const employeeNames = (form.employeeBudgets || []).map(item => item.memberName);
  const arNames = includeArNames ? (form.arHours || []).map(item => item.memberName) : [];
  const names = uniqueNames([pmName].concat(memberNames, employeeNames, arNames));

  form.employeeBudgets = applyEmployeeMeta(buildEmployeeBudgets(names, form.employeeBudgets || []), pmName);
  form.arHours = alignArHoursToEmployeeBudgets(form.employeeBudgets, form.arHours || []);
  return form;
}

function defaultForm() {
  return {
    projectName: '',
    customerName: '',
    projectNo: '',
    startDate: '',
    endDate: '',
    projectManager: '',
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
    budgetTotalHours: '',
    budgetHours: '',
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
      { id: createId('sub'), name: '', budgetHours: '', budgetLaborUnitPrice: 5000, plannedCompletedHours: '' }
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
    precalDisplay: buildPrecalDisplay(defaultForm())
  },

  onLoad(options) {
    const id = options && options.id ? options.id : '';
    this.setData({ id, isEdit: !!id, pageTitle: id ? '编辑项目' : '新增项目', readOnly: false });
    if (id) {
      this.loadDetail(id);
    } else {
      this.refreshPreview();
    }
  },

  loadDetail(id) {
    wx.showLoading({ title: '加载中' });
    projectService.getProjectDetail(id)
      .then(res => {
        const loaded = res.project || defaultForm();
        const readOnly = loaded._canEdit === false;
        let form = Object.assign(defaultForm(), loaded);
        form.constants = Object.assign({ hoursPerDay: 8, personDayCost: 5000 }, loaded.constants || {});
        form.subProjects = (loaded.subProjects && loaded.subProjects.length ? loaded.subProjects : defaultForm().subProjects)
          .map(item => Object.assign({ id: createId('sub') }, item));
        form.employeeBudgets = (loaded.employeeBudgets || []).map(item => Object.assign({ id: createId('emp') }, item));
        form.arHours = (loaded.arHours || []).map(item => Object.assign({ id: createId('ar') }, item));
        form = normalizePeopleStructures(form, { includeArNames: true });
        if (readOnly) {
          form.employeeBudgets = (form.employeeBudgets || []).map(item => Object.assign({}, item, { canRemove: false }));
        }
        const statusIndex = this.data.statusOptions.findIndex(item => item.value === form.status);
        this.setData({
          form,
          membersText: (form.projectMembers || []).join('、'),
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
    this.setData({ form }, () => this.refreshPreview());
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
      'service', 'salesOwnerName', 'orderValue', 'totalMD', 'budgetTotalHours', 'budgetHours',
      'projectTotalBudget', 'totalBudget', 'bac', 'travelFee', 'travelCost', 'operatingMargin'
    ].forEach(field => assignIfValue(form, field, incoming[field]));

    if (hasValue(incoming.sapNumbers)) form.sapNumbers = incoming.sapNumbers;
    if (hasValue(incoming.sapBindings)) form.sapBindings = incoming.sapBindings;
    if (hasValue(incoming.itemList)) form.itemList = incoming.itemList;
    if (hasValue(incoming.subProjects)) form.subProjects = incoming.subProjects.map(item => Object.assign({ id: createId('sub') }, item));
    if (hasValue(incoming.projectMembers)) form.projectMembers = incoming.projectMembers;
    if (hasValue(incoming.employeeBudgets)) form.employeeBudgets = incoming.employeeBudgets;
    if (hasValue(incoming.arHours)) form.arHours = incoming.arHours;
    form.constants = Object.assign({ hoursPerDay: 8, personDayCost: 5000 }, current.constants || {}, incoming.constants || {});

    const normalized = normalizePeopleStructures(form, { includeArNames: true });
    this.setData({
      form: normalized,
      membersText: (normalized.projectMembers || []).join('、'),
      sapSearchNo: normalizeSapNo(sapNo || incoming.mainSapNo || incoming.projectNo),
      precalPreview: incoming,
      hasPrecalPreview: true,
      precalDisplay: buildPrecalDisplay(normalized),
      lastSyncedSapNo: normalizeSapNo(sapNo || incoming.mainSapNo || incoming.projectNo),
      precalSyncMessage: '已同步 Pre-cal 数据'
    }, () => this.refreshPreview());
  },

  syncPrecalBySap(options) {
    if (this.data.readOnly || this.data.isEdit) return Promise.resolve({ skipped: true });
    const sapNo = normalizeSapNo(this.data.sapSearchNo);
    if (!sapNo) return Promise.resolve({ skipped: true });
    if (!options || !options.force) {
      if (sapNo === this.data.lastSyncedSapNo) return Promise.resolve({ skipped: true });
    }
    this.setData({ precalSyncing: true, precalSyncMessage: '' });
    wx.showLoading({ title: '同步中' });
    return projectService.loadPrecalBySap(sapNo)
      .then(res => {
        this.applyPrecalToProjectForm(res.project || {}, sapNo);
        wx.showToast({ title: '已同步 Pre-cal 数据', icon: 'success' });
        return res;
      })
      .catch(err => {
        const message = err.message || '同步 Pre-cal 数据失败';
        this.setData({ precalSyncMessage: message, precalPreview: null, hasPrecalPreview: false, lastSyncedSapNo: '', precalDisplay: buildPrecalDisplay(this.data.form) });
        wx.showToast({ title: message, icon: 'none' });
        throw err;
      })
      .finally(() => {
        this.setData({ precalSyncing: false });
        wx.hideLoading();
      });
  },

  onBasicInput(e) {
    if (this.data.readOnly) return;
    const field = e.currentTarget.dataset.field;
    let form = JSON.parse(JSON.stringify(this.data.form));
    form[field] = e.detail.value;
    if (field === 'projectManager') {
      form = normalizePeopleStructures(form);
    }
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
    const membersText = e.detail.value || '';
    let form = JSON.parse(JSON.stringify(this.data.form));
    form.projectMembers = parseMembersText(membersText);
    form = normalizePeopleStructures(form);
    this.setData({ membersText, form }, () => this.refreshPreview());
  },

  syncPeopleFromPmAndMembers() {
    if (this.data.readOnly) return;
    let form = JSON.parse(JSON.stringify(this.data.form));
    const names = uniqueNames([form.projectManager].concat(form.projectMembers || []));
    if (!names.length) {
      wx.showToast({ title: '请先填写项目经理 PM 或项目组员', icon: 'none' });
      return;
    }
    form.employeeBudgets = applyEmployeeMeta(buildEmployeeBudgets(names, form.employeeBudgets || []), form.projectManager);
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
    this.setData(data, () => this.refreshPreview());
  },

  addSubProject() {
    if (this.data.readOnly) return;
    const subProjects = this.data.form.subProjects.concat({
      id: createId('sub'),
      name: '',
      budgetHours: '',
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
    form.employeeBudgets = applyEmployeeMeta(form.employeeBudgets, form.projectManager);
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
    const preview = enrichProject(this.data.form);
    this.setData({ preview });
  },

  validateForm() {
    const form = this.data.form;
    if (!form.projectName && !form.projectNo) {
      wx.showToast({ title: '请填写项目名称或项目号', icon: 'none' });
      return false;
    }
    if (!normalizeName(form.projectManager)) {
      wx.showToast({ title: '请填写项目经理 PM；PM 会自动进入人员预算和 AR 工时', icon: 'none' });
      return false;
    }
    if (!form.subProjects || !form.subProjects.length) {
      wx.showToast({ title: '请至少填写一个子项目', icon: 'none' });
      return false;
    }
    return true;
  },

  normalizeForm() {
    let form = JSON.parse(JSON.stringify(this.data.form));
    form = normalizePeopleStructures(form);
    form.travelFee = toNullableNumber(form.travelFee);
    form.travelCost = toNullableNumber(form.travelCost || form.travelFee);
    form.orderValue = toNullableNumber(form.orderValue);
    form.totalMD = toNullableNumber(form.totalMD);
    form.budgetTotalHours = toNullableNumber(form.budgetTotalHours || form.budgetHours);
    form.budgetHours = toNullableNumber(form.budgetHours || form.budgetTotalHours);
    form.projectTotalBudget = toNullableNumber(form.projectTotalBudget || form.totalBudget);
    form.totalBudget = toNullableNumber(form.totalBudget || form.projectTotalBudget);
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
    form.projectMembers = Array.isArray(form.projectMembers) ? form.projectMembers.map(normalizeName).filter(Boolean) : [];
    form.subProjects = (form.subProjects || []).map(item => ({
      id: item.id || createId('sub'),
      name: item.name || '',
      sapNo: normalizeSapNo(item.sapNo || item.sapProjectNo),
      sapProjectNo: normalizeSapNo(item.sapProjectNo || item.sapNo),
      subProjectNo: String(item.subProjectNo || item.itemNo || '').trim(),
      itemNo: String(item.itemNo || '').trim(),
      itemDescription: String(item.itemDescription || '').trim(),
      budgetHours: toNullableNumber(item.budgetHours),
      budgetLaborUnitPrice: toNullableNumber(item.budgetLaborUnitPrice),
      plannedCompletedHours: toNullableNumber(item.plannedCompletedHours)
    }));
    form.employeeBudgets = (form.employeeBudgets || [])
      .filter(item => normalizeName(item.memberName))
      .map(item => ({
        id: item.id || createId('emp'),
        memberName: normalizeName(item.memberName),
        budgetHours: toNullableNumber(item.budgetHours)
      }));
    form.arHours = alignArHoursToEmployeeBudgets(form.employeeBudgets, form.arHours || [])
      .map(item => ({
        id: item.id || createId('ar'),
        memberName: normalizeName(item.memberName),
        hours: toNullableNumber(item.hours)
      }));
    return form;
  },

  saveProject() {
    if (this.data.readOnly) {
      wx.showToast({ title: '当前项目为只读', icon: 'none' });
      return;
    }
  
    const sapNo = String(this.data.sapSearchNo || '').trim();
    const ensureSynced = (!this.data.id && sapNo && sapNo !== this.data.lastSyncedSapNo)
      ? this.syncPrecalBySap({ force: true })
      : Promise.resolve();

    ensureSynced.then(() => {
      if (!this.validateForm()) return;
      const project = this.normalizeForm();
      wx.showLoading({ title: '保存中' });
      projectService.saveProject(this.data.id, project)
      .then(res => {
        if (!this.data.id && res.id) {
          this.setData({ id: res.id, isEdit: true });
        }
        wx.showToast({ title: '已保存', icon: 'success' });
      })
      .catch(err => {
        wx.showToast({ title: err.message || '保存失败', icon: 'none' });
      })
      .finally(() => wx.hideLoading());
    }).catch(() => {});
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/projects/projects' })
    });
  }
});

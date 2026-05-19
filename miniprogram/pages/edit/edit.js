const projectService = require('../../services/projectService');
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
  return (employeeBudgets || []).map(item => Object.assign({}, item, {
    isPm: !!pmName && normalizeName(item.memberName) === pmName
  }));
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
    pageTitle: '新增项目'
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
    this.setData({ [`form.${field}`]: e.detail.value }, () => this.refreshPreview());
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
    this.setData({ [`form.subProjects[${index}].${field}`]: e.detail.value }, () => this.refreshPreview());
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
    this.setData({ [`form.arHours[${index}].hours`]: e.detail.value }, () => this.refreshPreview());
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
    form.travelFee = Number(form.travelFee || 0);
    form.constants = {
      hoursPerDay: 8,
      personDayCost: Number((form.constants && form.constants.personDayCost) || 5000)
    };
    form.projectMembers = Array.isArray(form.projectMembers) ? form.projectMembers.map(normalizeName).filter(Boolean) : [];
    form.subProjects = (form.subProjects || []).map(item => ({
      id: item.id || createId('sub'),
      name: item.name || '',
      budgetHours: Number(item.budgetHours || 0),
      budgetLaborUnitPrice: Number(item.budgetLaborUnitPrice || 0),
      plannedCompletedHours: Number(item.plannedCompletedHours || 0)
    }));
    form.employeeBudgets = (form.employeeBudgets || [])
      .filter(item => normalizeName(item.memberName))
      .map(item => ({
        id: item.id || createId('emp'),
        memberName: normalizeName(item.memberName),
        budgetHours: Number(item.budgetHours || 0)
      }));
    form.arHours = alignArHoursToEmployeeBudgets(form.employeeBudgets, form.arHours || [])
      .map(item => ({
        id: item.id || createId('ar'),
        memberName: normalizeName(item.memberName),
        hours: Number(item.hours || 0)
      }));
    return form;
  },

  saveProject() {
    if (this.data.readOnly) {
      wx.showToast({ title: '当前项目为只读', icon: 'none' });
      return;
    }
  
    if (!this.validateForm()) return;
  
    const project = this.normalizeForm();
  
    wx.showLoading({ title: '保存中' });
  
    projectService.saveProject(this.data.id, project)
      .then(res => {
        wx.hideLoading();
  
        if (!this.data.id && res.id) {
          this.setData({ id: res.id, isEdit: true });
        }
  
        wx.showToast({ title: '已保存', icon: 'success' });
      })
      .catch(err => {
        wx.hideLoading();
        wx.showToast({ title: err.message || '保存失败', icon: 'none' });
      });
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/projects/projects' })
    });
  }
});

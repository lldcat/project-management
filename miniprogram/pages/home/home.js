const projectService = require('../../services/projectService');
const precalService = require('../../services/precalService');
const { enrichProject, formatMoney, formatNumber } = require('../../utils/metrics');

Page({
  data: {
    loading: false,
    projects: [],
    riskProjects: [],
    scopeText: 'PM 默认只看自己的项目。',
    userRoleText: 'PM',
    showPrecalStats: false,
    precalScopeText: '按当前身份统计可见的 Pre-cal 数据。',
    stats: {
      total: 0,
      risk: 0,
      overCost: 0,
      delayed: 0,
      bacText: '-',
      laborBudgetText: '-',
      employeeBudgetHoursText: '-',
      actualCostText: '-',
      cvText: '-',
      svText: '-',
      cvClass: '',
      svClass: ''
    },
    precalStats: {
      total: 0,
      draft: 0,
      pendingSap: 0,
      sapBound: 0,
      projectCreated: 0,
      other: 0,
      withdrawn: 0,
      unlocked: 0,
      cancelled: 0
    }
  },

  onShow() {
    this.loadData();
  },

  onPullDownRefresh() {
    this.loadData().finally(() => wx.stopPullDownRefresh());
  },

  reload() {
    this.loadData();
  },

  loadData() {
    this.setData({ loading: true });
    return projectService.listProjects({})
      .then(res => {
        const projects = (res.projects || []).map(item => {
          const project = enrichProject(item);
          project.displayPmName = project.pmName || project.projectManager || '-';
          project.projectNameText = project.projectName || '未命名项目';
          project.projectNoText = project.projectNo || '无项目号';
          return project;
        });
        const stats = this.buildStats(projects);
        const riskProjects = projects.filter(item => item.metrics.hasRisk).slice(0, 8);
        const user = res.user || {};
        const roles = this.normalizeRoles(user);
        const privileged = roles.indexOf('admin') >= 0 || roles.indexOf('ar') >= 0;
        this.setData({
          projects,
          riskProjects,
          stats,
          userRoleText: roles.map(item => this.formatRole(item)).join(' / '),
          scopeText: privileged ? '当前为管理视角，正在汇总所有 PM 的项目。' : '当前为 PM 视角，只汇总自己创建的项目。'
        });
        return this.loadPrecalStats(roles);
      })
      .catch(err => {
        console.error(err);
        wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      })
      .finally(() => this.setData({ loading: false }));
  },

  loadPrecalStats(roles) {
    const hasSales = roles.indexOf('sales') >= 0;
    const hasCS = roles.indexOf('cs') >= 0;
    const hasAdmin = roles.indexOf('admin') >= 0;
    const canSeePrecal = hasSales || hasCS || hasAdmin;
    if (!canSeePrecal) {
      this.setData({ showPrecalStats: false, precalStats: this.buildPrecalStatusStats([]) });
      return Promise.resolve();
    }

    const calls = [];
    if (hasAdmin) {
      calls.push(precalService.listPrecalForAdmin({ status: 'all' }).then(res => ({ source: 'admin', records: res.records || [] })));
    } else {
      if (hasCS) calls.push(precalService.listPrecalForCS({ status: 'all' }).then(res => ({ source: 'cs', records: res.records || [] })));
      if (hasSales) calls.push(precalService.listMyPrecal({ status: 'all' }).then(res => ({ source: 'sales', records: res.records || [] })));
    }

    return Promise.all(calls)
      .then(results => {
        const merged = {};
        results.forEach(group => {
          (group.records || []).forEach(record => {
            merged[record._id || record.precalNo] = record;
          });
        });
        const records = Object.keys(merged).map(key => merged[key]);
        this.setData({
          showPrecalStats: true,
          precalScopeText: hasAdmin ? 'Admin 视角：统计全部 Pre-cal 状态。' : (hasCS ? 'CS 视角：统计可见的已提交和已绑定 SAP Pre-cal。' : 'Sales 视角：统计自己创建的全部 Pre-cal 状态。'),
          precalStats: this.buildPrecalStatusStats(records)
        });
      })
      .catch(err => {
        console.error('load precal stats failed', err);
        this.setData({ showPrecalStats: false });
      });
  },

  buildPrecalStatusStats(records) {
    const list = records || [];
    const stats = {
      total: list.length,
      draft: 0,
      pendingSap: 0,
      sapBound: 0,
      projectCreated: 0,
      withdrawn: 0,
      unlocked: 0,
      cancelled: 0,
      other: 0
    };
    list.forEach(item => {
      const status = item && item.status;
      if (status === 'Draft') stats.draft += 1;
      else if (status === 'Submitted') stats.pendingSap += 1;
      else if (status === 'SAP Bound') stats.sapBound += 1;
      else if (status === 'Project Created') {
        stats.sapBound += 1;
        stats.projectCreated += 1;
      }
      else {
        stats.other += 1;
        if (status === 'Withdrawn') stats.withdrawn += 1;
        if (status === 'Unlocked') stats.unlocked += 1;
        if (status === 'Cancelled') stats.cancelled += 1;
      }
    });
    return stats;
  },

  normalizeRoles(user) {
    if (user && Array.isArray(user.roles) && user.roles.length) return user.roles;
    return ['pm'];
  },

  formatRole(role) {
    const map = {
      pm: 'PM',
      admin: '系统管理员',
      ar: 'AR核对人',
      member: '普通组员',
      sales: 'Sales',
      cs: 'CS'
    };
    return map[role] || role || 'PM';
  },

  buildStats(projects) {
    const sum = projects.reduce((acc, p) => {
      const m = p.metrics || {};
      acc.bac += Number(m.bac || 0);
      acc.laborBudget += Number(m.laborBudget || 0);
      acc.actualCost += Number(m.actualCost || 0);
      acc.employeeBudgetHours += Number(m.sumEmployeeBudgetHours || 0);
      acc.cv += Number(m.costVariance || 0);
      acc.sv += Number(m.scheduleVariance || 0);
      if (m.hasRisk) acc.risk += 1;
      if (m.costVariance < 0 || m.costPerformanceIndex < 1) acc.overCost += 1;
      if (m.scheduleVariance < 0 || m.schedulePerformanceIndex < 1) acc.delayed += 1;
      return acc;
    }, { bac: 0, laborBudget: 0, actualCost: 0, employeeBudgetHours: 0, cv: 0, sv: 0, risk: 0, overCost: 0, delayed: 0 });

    return {
      total: projects.length,
      risk: sum.risk,
      overCost: sum.overCost,
      delayed: sum.delayed,
      bacText: formatMoney(sum.bac),
      laborBudgetText: formatMoney(sum.laborBudget),
      employeeBudgetHoursText: formatNumber(sum.employeeBudgetHours),
      actualCostText: formatMoney(sum.actualCost),
      cvText: formatMoney(sum.cv),
      svText: formatMoney(sum.sv),
      cvClass: sum.cv < 0 ? 'negative' : 'positive',
      svClass: sum.sv < 0 ? 'negative' : 'positive'
    };
  },

  goEdit(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/edit/edit?id=${id}` });
  }
});

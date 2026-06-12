const projectService = require('../../services/projectService');
const precalService = require('../../services/precalService');
const { normalizeRoles } = require('../../services/permissionService');

Page({
  data: {
    loading: false,
    scopeText: '按当前身份统计可见项目概览。',
    userRoleText: 'PM',
    showPrecalStats: false,
    precalScopeText: '按当前身份统计可见的 Pre-cal 数据。',
    projectStats: {
      total: 0,
      active: 0,
      owned: 0,
      participated: 0
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
    return Promise.all([this.loadProjectStats(), this.loadPrecalStats()])
      .finally(() => this.setData({ loading: false }));
  },

  loadProjectStats() {
    return projectService.getDashboardOverview({})
      .then(res => {
        const user = res.user || {};
        const roles = normalizeRoles(user);
        this.setData({
          projectStats: this.normalizeProjectStats(res.projectStats),
          userRoleText: roles.map(item => this.formatRole(item)).join(' / '),
          scopeText: res.scopeText || '按当前身份统计可见项目概览。'
        });
      })
      .catch(err => {
        console.error('load project stats failed', err);
        wx.showToast({ title: '项目概览加载失败', icon: 'none' });
      });
  },

  loadPrecalStats() {
    return precalService.getPrecalOverview({})
      .then(res => {
        this.setData({
          showPrecalStats: res.visible !== false,
          precalScopeText: res.scopeText || '按当前身份统计可见的 Pre-cal 数据。',
          precalStats: Object.assign({}, this.defaultPrecalStats(), res.stats || {})
        });
      })
      .catch(err => {
        console.error('load precal stats failed', err);
        this.setData({ showPrecalStats: false });
      });
  },

  normalizeProjectStats(stats) {
    return Object.assign({
      total: 0,
      active: 0,
      owned: 0,
      participated: 0
    }, stats || {});
  },

  defaultPrecalStats() {
    return {
      total: 0,
      draft: 0,
      pendingSap: 0,
      sapBound: 0,
      projectCreated: 0,
      other: 0,
      withdrawn: 0,
      unlocked: 0,
      cancelled: 0
    };
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
  }
});

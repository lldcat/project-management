const app = getApp();
const userService = require('../../services/userService');
const { DEFAULT_ROLES, normalizeRoles, hasAnyRole, isAdmin, isSales } = require('../../services/permissionService');

Page({
  data: {
    loading: false,
    userName: '',
    roleText: '',
    roles: [],
    showProjectOps: false,
    showSalesOps: false,
    showCSOps: false,
    showAdminOps: false
  },

  onShow() {
    this.loadUser();
  },

  loadUser() {
    const user = app.globalData.user;
    if (user) {
      this.applyUser(user);
      return;
    }
    this.setData({ loading: true });
    userService.login()
      .then(res => {
        const result = res || {};
        app.globalData.openid = result.openid || '';
        app.globalData.user = result.user || null;
        this.applyUser(result.user || {});
      })
      .catch(err => {
        console.error(err);
        wx.showToast({ title: '身份加载失败', icon: 'none' });
        this.applyUser({ roles: DEFAULT_ROLES });
      })
      .finally(() => this.setData({ loading: false }));
  },

  applyUser(user) {
    const roles = this.normalizeRoles(user);
    this.setData({
      userName: user.displayName || user.userName || user.name || '当前用户',
      roles,
      roleText: roles.map(item => this.formatRole(item)).join(' / ') || '-',
      showProjectOps: hasAnyRole({ roles }, ['pm', 'admin']),
      showSalesOps: isSales({ roles }),
      showCSOps: hasAnyRole({ roles }, ['cs', 'admin']),
      showAdminOps: isAdmin({ roles })
    });
  },

  normalizeRoles(user) {
    return normalizeRoles(user);
  },

  formatRole(role) {
    const map = {
      pm: 'PM',
      admin: '系统管理员',
      ar: 'AR核对人',
      sales: 'Sales',
      cs: 'CS'
    };
    return map[role] || role || 'PM';
  },

  goCreateProject() {
    const user = app.globalData.user || {};
    if (!String(user.name || '').trim()) {
      wx.showToast({ title: '请先在“我的”页填写姓名', icon: 'none' });
      wx.switchTab({ url: '/pages/settings/settings' });
      return;
    }
    wx.navigateTo({ url: '/pages/edit/edit' });
  },

  goProjectList() {
    wx.switchTab({ url: '/pages/projects/projects' });
  },

  goNewPrecal() {
    wx.navigateTo({ url: '/pages/precal/edit/index' });
  },

  goMyPrecal() {
    wx.navigateTo({ url: '/pages/precal/list/index' });
  },

  goSapBinding() {
    wx.navigateTo({ url: '/pages/precal-cs/list/index' });
  },

  goAdminPrecal() {
    wx.navigateTo({ url: '/pages/admin/precal-list/index' });
  },

  goParameters() {
    wx.navigateTo({ url: '/pages/admin/precal-parameters/index' });
  },

  goUserAdmin() {
    wx.navigateTo({ url: '/pages/admin/users/index' });
  }
});

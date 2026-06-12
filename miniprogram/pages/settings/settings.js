const app = getApp();
const userService = require('../../services/userService');
const { normalizeActualRoles } = require('../../services/permissionService');

const ROLE_VIEW_OPTIONS = [
  { key: 'admin', label: '真实 Admin 视角', roles: [] },
  { key: 'pm_sales', label: 'PM + Sales 视角', roles: ['pm', 'sales'] },
  { key: 'pm', label: '仅 PM 视角', roles: ['pm'] },
  { key: 'sales', label: '仅 Sales 视角', roles: ['sales'] },
  { key: 'cs', label: 'CS 视角', roles: ['cs'] },
  { key: 'ar', label: 'AR 视角', roles: ['ar'] },
  { key: 'member', label: '项目组员视角', roles: ['member'] }
];

Page({
  data: {
    name: '',
    nameInput: '',
    missingName: false,
    savingName: false,
    loginStatusText: '未登录',
    accountStatusText: 'Active',
    canSwitchRoleView: false,
    roleViewOptions: ROLE_VIEW_OPTIONS,
    roleViewIndex: 0,
    roleViewText: '真实 Admin 视角'
  },

  onShow() {
    this.loadUser();
  },

  loadUser() {
    const user = app.globalData.user || {};
    const actualRoles = normalizeActualRoles(user);
    const canSwitchRoleView = actualRoles.indexOf('admin') >= 0;
    const roleViewKey = canSwitchRoleView ? (app.globalData.roleViewKey || 'admin') : 'admin';
    const roleViewIndex = Math.max(0, ROLE_VIEW_OPTIONS.findIndex(item => item.key === roleViewKey));
    const option = ROLE_VIEW_OPTIONS[roleViewIndex] || ROLE_VIEW_OPTIONS[0];
    this.setData({
      name: user.name || '',
      nameInput: user.name || '',
      missingName: !String(user.name || '').trim(),
      loginStatusText: user && user._id ? '已登录' : '未登录',
      accountStatusText: user.active === false ? 'Disabled' : 'Active',
      canSwitchRoleView,
      roleViewIndex,
      roleViewText: option.label
    });
  },

  onRoleViewChange(e) {
    const index = Number(e.detail.value || 0);
    const option = ROLE_VIEW_OPTIONS[index] || ROLE_VIEW_OPTIONS[0];
    app.globalData.roleViewKey = option.key;
    app.globalData.roleViewRoles = option.roles.slice();
    if (option.roles.length) {
      wx.setStorageSync('adminRoleView', { key: option.key, roles: option.roles });
    } else {
      wx.removeStorageSync('adminRoleView');
    }
    this.setData({
      roleViewIndex: index,
      roleViewText: option.label
    });
    wx.showToast({ title: '测试视角已切换', icon: 'success' });
  },

  onNameInput(e) {
    this.setData({ nameInput: e.detail.value || '' });
  },

  saveName() {
    const name = String(this.data.nameInput || '').trim();
    if (!name) {
      wx.showToast({ title: '请填写姓名', icon: 'none' });
      return;
    }
    this.setData({ savingName: true });
    userService.updateName(name)
      .then(res => {
        const result = res || {};
        app.globalData.openid = result.openid || (result.user && result.user.openid) || app.globalData.openid || '';
        app.globalData.user = result.user || app.globalData.user;
        this.loadUser();
        wx.showToast({ title: '姓名已保存', icon: 'success' });
      })
      .catch(err => {
        console.error(err);
        wx.showToast({ title: err.message || '保存失败', icon: 'none' });
      })
      .finally(() => this.setData({ savingName: false }));
  },

  refreshLogin() {
    wx.showLoading({ title: '刷新中' });
    userService.login()
      .then(res => {
        const result = res || {};
        app.globalData.openid = result.openid || '';
        app.globalData.user = result.user || null;
        if (normalizeActualRoles(app.globalData.user).indexOf('admin') < 0) {
          app.globalData.roleViewKey = 'admin';
          app.globalData.roleViewRoles = [];
          wx.removeStorageSync('adminRoleView');
        }
        this.loadUser();
        wx.showToast({ title: '登录状态已刷新', icon: 'success' });
      })
      .catch(err => {
        console.error(err);
        wx.showToast({ title: '登录状态刷新失败', icon: 'none' });
      })
      .finally(() => wx.hideLoading());
  }
});

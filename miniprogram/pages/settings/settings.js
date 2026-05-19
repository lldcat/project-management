const app = getApp();
const userService = require('../../services/userService');

Page({
  data: {
    openid: '',
    envId: '',
    role: 'pm',
    roles: ['pm'],
    roleText: 'PM'
  },

  onShow() {
    this.loadUser();
  },

  loadUser() {
    const user = app.globalData.user || {};
    const roles = Array.isArray(user.roles) && user.roles.length ? user.roles : [user.role || 'pm'];
    const role = user.role || roles[0] || 'pm';
    this.setData({
      openid: app.globalData.openid || user.openid || '',
      envId: app.globalData.envId || '',
      role,
      roles,
      roleText: roles.map(item => this.formatRole(item)).join(' / ')
    });
  },

  formatRole(role) {
    const map = {
      pm: 'PM',
      leader: '部门Leader',
      admin: '系统管理员',
      ar: 'AR核对人',
      member: '普通组员',
      sales: 'Sales',
      cs: 'CS'
    };
    return map[role] || role || 'PM';
  },

  refreshLogin() {
    wx.showLoading({ title: '刷新中' });
    userService.login()
      .then(res => {
        const result = res || {};
        app.globalData.openid = result.openid || '';
        app.globalData.user = result.user || null;
        this.loadUser();
        wx.showToast({ title: '已刷新', icon: 'success' });
      })
      .catch(err => {
        console.error(err);
        wx.showToast({ title: '刷新失败', icon: 'none' });
      })
      .finally(() => wx.hideLoading());
  }
});

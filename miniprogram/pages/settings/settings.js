const app = getApp();
const userService = require('../../services/userService');

Page({
  data: {
    name: '',
    nameInput: '',
    missingName: false,
    savingName: false,
    loginStatusText: '未登录',
    accountStatusText: 'Active'
  },

  onShow() {
    this.loadUser();
  },

  loadUser() {
    const user = app.globalData.user || {};
    this.setData({
      name: user.name || '',
      nameInput: user.name || '',
      missingName: !String(user.name || '').trim(),
      loginStatusText: user && user._id ? '已登录' : '未登录',
      accountStatusText: user.active === false ? 'Disabled' : 'Active'
    });
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

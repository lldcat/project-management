const env = require('./config/env');
const userService = require('./services/userService');
const { PROJECT_CONSTANTS } = require('./config/constants');
const { normalizeRoles } = require('./services/permissionService');

App({
  globalData: {
    envId: env.cloudEnvId,
    mode: env.mode,
    user: null,
    openid: '',
    constants: {
      hoursPerDay: PROJECT_CONSTANTS.hoursPerDay,
      personDayCost: PROJECT_CONSTANTS.personDayCost
    }
  },

  onLaunch() {
    if (env.mode === 'cloudbase') {
      if (!wx.cloud) {
        wx.showModal({
          title: '基础库版本过低',
          content: '请升级微信开发者工具或微信版本后再使用云开发功能。',
          showCancel: false
        });
        return;
      }

      wx.cloud.init({
        env: env.cloudEnvId,
        traceUser: true
      });
    }

    this.bootstrapUser();
  },

  bootstrapUser() {
    userService.login()
      .then(result => {
        this.globalData.openid = result.openid || (result.user && result.user.openid) || '';
        this.globalData.user = result.user ? Object.assign({}, result.user, { roles: normalizeRoles(result.user) }) : null;
        if (result.user && !String(result.user.name || '').trim()) {
          wx.showModal({
            title: '请填写姓名',
            content: '首次使用需要填写姓名，项目 PM 和分配工时会使用该姓名。',
            showCancel: false,
            success: () => wx.switchTab({ url: '/pages/settings/settings' })
          });
        }
      })
      .catch(err => {
        console.error('login failed', err);
        wx.showToast({ title: '登录初始化失败', icon: 'none' });
      });
  }
});

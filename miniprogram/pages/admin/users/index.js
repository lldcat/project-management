const userService = require('../../../services/userService');

const ROLE_OPTIONS = [
  { key: 'pm', label: 'PM' },
  { key: 'sales', label: 'Sales' },
  { key: 'cs', label: 'CS' },
  { key: 'ar', label: 'AR' },
  { key: 'leader', label: 'Leader' },
  { key: 'admin', label: 'Admin' }
];

function normalizeRoles(user) {
  if (user && Array.isArray(user.roles) && user.roles.length) return user.roles.map(String);
  if (user && user.role) return [String(user.role)];
  return ['pm'];
}

function roleText(roles) {
  const map = { pm: 'PM', sales: 'Sales', cs: 'CS', ar: 'AR', leader: 'Leader', admin: 'Admin', member: '成员' };
  return (roles || []).map(role => map[role] || role).join(' / ');
}

Page({
  data: {
    users: [],
    roleOptions: ROLE_OPTIONS,
    loading: false,
    savingOpenid: ''
  },

  onShow() {
    this.loadData();
  },

  onPullDownRefresh() {
    this.loadData().finally(() => wx.stopPullDownRefresh());
  },

  loadData() {
    this.setData({ loading: true });
    return userService.listUsers()
      .then(res => {
        const users = (res.users || []).map(item => {
          const roles = normalizeRoles(item);
          return Object.assign({}, item, {
            displayName: item.name || item.employeeName || item.openid || item._openid || item._id || '-',
            displayOpenid: item.openid || item._openid || item._id || '-',
            roles,
            roleText: roleText(roles),
            roleOptions: ROLE_OPTIONS.map(option => Object.assign({}, option, {
              checked: roles.indexOf(option.key) >= 0
            }))
          });
        });
        this.setData({ users });
      })
      .catch(err => wx.showToast({ title: err.message || '加载失败', icon: 'none' }))
      .finally(() => this.setData({ loading: false }));
  },

  onRoleChange(e) {
    const index = Number(e.currentTarget.dataset.index);
    const values = e.detail.value || [];
    const users = this.data.users.slice();
    const user = users[index];
    if (!user) return;
    user.roles = values.length ? values : ['pm'];
    user.roleText = roleText(user.roles);
    user.roleOptions = ROLE_OPTIONS.map(option => Object.assign({}, option, {
      checked: user.roles.indexOf(option.key) >= 0
    }));
    users[index] = user;
    this.setData({ users });
  },

  saveRoles(e) {
    const index = Number(e.currentTarget.dataset.index);
    const user = this.data.users[index];
    if (!user) return;
    const openid = user.openid || user._openid || user._id;
    this.setData({ savingOpenid: openid });
    userService.updateUserRoles(openid, user.roles)
      .then(() => {
        wx.showToast({ title: '已保存', icon: 'success' });
        this.loadData();
      })
      .catch(err => wx.showToast({ title: err.message || '保存失败', icon: 'none' }))
      .finally(() => this.setData({ savingOpenid: '' }));
  }
});

const userService = require('../../../services/userService');
const { DEFAULT_ROLES, normalizeActualRoles } = require('../../../services/permissionService');

const ROLE_OPTIONS = [
  { key: 'pm', label: 'PM' },
  { key: 'sales', label: 'Sales' },
  { key: 'cs', label: 'CS' },
  { key: 'ar', label: 'AR' },
  { key: 'admin', label: 'Admin' }
];

function roleText(roles) {
  const map = { pm: 'PM', sales: 'Sales', cs: 'CS', ar: 'AR', admin: 'Admin', member: '成员' };
  return (roles || []).map(role => map[role] || role).join(' / ');
}

function formatDateTime(value) {
  if (!value) return '-';
  const raw = value && typeof value === 'object' && typeof value.$date === 'number' ? value.$date : value;
  const date = raw instanceof Date ? raw : new Date(raw);
  if (!Number.isFinite(date.getTime())) return '-';
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

Page({
  data: {
    users: [],
    roleOptions: ROLE_OPTIONS,
    loading: false,
    savingUserId: ''
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
          const roles = normalizeActualRoles(item);
          return Object.assign({}, item, {
            displayName: item.name || '未填写姓名',
            roles,
            roleText: roleText(roles),
            activeText: item.active === false ? 'Disabled' : 'Active',
            activeTagClass: item.active === false ? 'tag-disabled' : 'tag-normal',
            createdAtText: formatDateTime(item.createdAt),
            updatedAtText: formatDateTime(item.updatedAt),
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
    user.roles = values.length ? values : DEFAULT_ROLES.slice();
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
    const userId = user._id;
    this.setData({ savingUserId: userId });
    userService.updateUserRoles(userId, user.roles)
      .then(() => {
        wx.showToast({ title: '已保存', icon: 'success' });
        this.loadData();
      })
      .catch(err => wx.showToast({ title: err.message || '保存失败', icon: 'none' }))
      .finally(() => this.setData({ savingUserId: '' }));
  }
});

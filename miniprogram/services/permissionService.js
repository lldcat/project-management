const DEFAULT_ROLES = ['pm', 'sales'];
const ALLOWED_ROLE_MAP = { admin: true, pm: true, sales: true, cs: true, ar: true, leader: true, member: true };

function normalizeActualRoles(user) {
  const seen = {};
  const result = [];
  const add = role => {
    const clean = String(role || '').trim();
    if (ALLOWED_ROLE_MAP[clean] && !seen[clean]) {
      seen[clean] = true;
      result.push(clean);
    }
  };

  if (user && Array.isArray(user.roles) && user.roles.length) {
    user.roles.forEach(add);
  }
  if (!result.length) DEFAULT_ROLES.forEach(add);
  return result;
}

function getAdminViewRoles(user) {
  let app = null;
  try {
    app = getApp && getApp();
  } catch (err) {
    app = null;
  }
  const globalData = app && app.globalData;
  if (!globalData || !Array.isArray(globalData.roleViewRoles) || !globalData.roleViewRoles.length) return null;
  const actualRoles = normalizeActualRoles(globalData.user || user);
  if (actualRoles.indexOf('admin') < 0) return null;
  return normalizeActualRoles({ roles: globalData.roleViewRoles });
}

function normalizeRoles(user) {
  return getAdminViewRoles(user) || normalizeActualRoles(user);
}

function hasRole(user, role) {
  return normalizeRoles(user).indexOf(role) >= 0;
}

function hasAnyRole(user, roles) {
  const userRoles = normalizeRoles(user);
  return (roles || []).some(role => userRoles.indexOf(role) >= 0);
}

module.exports = {
  DEFAULT_ROLES,
  normalizeRoles,
  normalizeActualRoles,
  hasRole,
  hasAnyRole,
  isAdmin: user => hasRole(user, 'admin'),
  isPM: user => hasRole(user, 'pm'),
  isSales: user => hasRole(user, 'sales')
};

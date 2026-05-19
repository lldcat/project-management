function normalizeRoles(user) {
  if (user && Array.isArray(user.roles) && user.roles.length) return user.roles;
  if (user && user.role) return [user.role];
  return [];
}

function hasRole(user, role) {
  return normalizeRoles(user).indexOf(role) >= 0;
}

function hasAnyRole(user, roles) {
  const userRoles = normalizeRoles(user);
  return (roles || []).some(role => userRoles.indexOf(role) >= 0);
}

module.exports = {
  normalizeRoles,
  hasRole,
  hasAnyRole
};

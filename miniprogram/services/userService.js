const apiClient = require('../api/apiClient');

function login() {
  return apiClient.login();
}

function getCurrentUser() {
  const app = getApp && getApp();
  return (app && app.globalData && app.globalData.user) || null;
}

function updateName(name) {
  return apiClient.call('login', 'updateName', { name });
}

function listUsers() {
  return apiClient.call('login', 'listUsers', {});
}

function updateUserRoles(openid, roles) {
  return apiClient.call('login', 'updateUserRoles', { openid, roles });
}

module.exports = {
  login,
  getCurrentUser,
  updateName,
  listUsers,
  updateUserRoles
};

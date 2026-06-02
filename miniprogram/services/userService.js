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

module.exports = {
  login,
  getCurrentUser,
  updateName
};

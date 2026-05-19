const apiClient = require('../api/apiClient');

function login() {
  return apiClient.login();
}

function getCurrentUser() {
  const app = getApp && getApp();
  return (app && app.globalData && app.globalData.user) || null;
}

module.exports = {
  login,
  getCurrentUser
};

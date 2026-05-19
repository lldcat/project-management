function syncUser(result) {
  if (!result || !result.user) return;
  const app = getApp && getApp();
  if (app && app.globalData) {
    app.globalData.user = result.user;
    app.globalData.openid = result.user.openid || result.openid || app.globalData.openid || '';
  }
}

function normalizeResult(res) {
  const result = (res && res.result) || {};
  const ok = result.ok === true || result.success === true;
  if (!ok) {
    const message = result.message || '云函数调用失败';
    throw new Error(message);
  }
  syncUser(result);
  return result;
}

function callFunction(functionName, action, data) {
  const payload = data || {};
  const callData = functionName === 'projectService'
    ? Object.assign({ action }, payload)
    : { action, payload };

  return wx.cloud.callFunction({
    name: functionName,
    data: callData
  }).then(normalizeResult);
}

function login() {
  return wx.cloud.callFunction({
    name: 'login',
    data: {}
  }).then(normalizeResult);
}

module.exports = {
  callFunction,
  login
};

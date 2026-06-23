function getAppData() {
  try {
    const app = getApp && getApp();
    return app && app.globalData || null;
  } catch (err) {
    return null;
  }
}

function syncUser(result) {
  if (!result || !result.user) return;
  const globalData = getAppData();
  if (globalData) {
    globalData.user = result.user;
    globalData.openid = result.user.openid || result.openid || globalData.openid || '';
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
  const payload = Object.assign({}, data || {});
  const callData = functionName === 'projectService'
    ? Object.assign({ action }, payload)
    : { action, payload };
  const startedAt = Date.now();

  return wx.cloud.callFunction({
    name: functionName,
    data: callData
  }).then(normalizeResult).catch(err => {
    console.error(`[cloudbaseClient] ${functionName}.${action || '-'} 调用失败，用时 ${Date.now() - startedAt}ms`, err);
    throw err;
  });
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

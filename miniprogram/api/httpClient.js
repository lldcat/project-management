const env = require('../config/env');

function buildUrl(path) {
  const baseUrl = String(env.httpBaseUrl || '').replace(/\/$/, '');
  const cleanPath = String(path || '').replace(/^\//, '');
  if (!baseUrl) throw new Error('HTTP baseUrl 未配置，无法调用公司服务器接口。');
  return `${baseUrl}/${cleanPath}`;
}

function request(method, path, data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: buildUrl(path),
      method,
      data: data || {},
      timeout: env.requestTimeout || 30000,
      header: { 'content-type': 'application/json' },
      success(res) {
        const body = res.data || {};
        const ok = body.ok === true || body.success === true;
        if (!ok) {
          reject(new Error(body.message || `HTTP ${res.statusCode || ''} 接口调用失败`));
          return;
        }
        if (body.user) {
          const app = getApp && getApp();
          if (app && app.globalData) {
            app.globalData.user = body.user;
            app.globalData.openid = body.user.openid || body.openid || app.globalData.openid || '';
          }
        }
        resolve(body);
      },
      fail(err) {
        reject(new Error(err.errMsg || '公司服务器接口请求失败'));
      }
    });
  });
}

function get(path, params) {
  return request('GET', path, params || {});
}

function post(path, data) {
  return request('POST', path, data || {});
}

function call(functionName, action, data) {
  return post(`${functionName}/${action}`, data || {});
}

function login() {
  return post('login', {});
}

module.exports = {
  get,
  post,
  call,
  login
};

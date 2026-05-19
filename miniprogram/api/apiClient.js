const env = require('../config/env');
const cloudbaseClient = require('./cloudbaseClient');
const httpClient = require('./httpClient');

function isHttpMode() {
  return env.mode === 'http';
}

function call(functionName, action, data) {
  if (isHttpMode()) {
    return httpClient.call(functionName, action, data || {});
  }
  return cloudbaseClient.callFunction(functionName, action, data || {});
}

function login() {
  if (isHttpMode()) return httpClient.login();
  return cloudbaseClient.login();
}

function get(url, params) {
  if (!isHttpMode()) throw new Error('当前为 CloudBase 模式，不能直接调用 HTTP GET。');
  return httpClient.get(url, params || {});
}

function post(url, data) {
  if (!isHttpMode()) throw new Error('当前为 CloudBase 模式，不能直接调用 HTTP POST。');
  return httpClient.post(url, data || {});
}

function upload() {
  throw new Error('文件上传接口尚未启用。');
}

function download() {
  throw new Error('文件下载接口尚未启用。');
}

module.exports = {
  call,
  login,
  get,
  post,
  upload,
  download
};

const ENV = {
  // CloudBase（微信云开发）与 HTTP（公司服务器）二选一：
  // - cloudbase: 通过 wx.cloud.callFunction 调用云函数
  // - http: 通过 wx.request 调用公司服务器（见 miniprogram/api/httpClient.js）
  mode: 'cloudbase',
  cloudEnvId: 'cloud1-6gwp2land6cda07f',
  // 当 mode='http' 时填写，例如：https://your-company-api.example.com
  httpBaseUrl: '',
  requestTimeout: 30000
};

module.exports = ENV;

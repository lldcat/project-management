# v1.1 可迁移架构加固说明

本版本在 v1.0 的 AUD Pre-cal 功能基础上，增加了便于后续迁移到公司服务器的前端分层结构。

## 已完成的架构调整

1. 新增 `miniprogram/config/env.js`
   - 当前模式：`cloudbase`
   - 当前云环境：`cloud1-6gwp2land6cda07f`
   - 后续切公司服务器时可改为 `http`，并配置 `httpBaseUrl`

2. 新增 `miniprogram/api/`
   - `apiClient.js`：统一接口入口
   - `cloudbaseClient.js`：当前调用 CloudBase 云函数
   - `httpClient.js`：预留公司服务器 HTTP API 调用

3. 新增 `miniprogram/services/`
   - `userService.js`
   - `projectService.js`
   - `precalService.js`
   - `permissionService.js`

4. 页面层调整
   - 页面不再直接调用 `wx.cloud.callFunction()`
   - 页面不再直接引用 `utils/cloud.js`
   - 页面统一调用 `services` 层

5. 环境 ID 收口
   - 环境 ID 只保留在 `miniprogram/config/env.js`
   - `app.js` 通过配置读取环境 ID

6. 数据治理调整
   - `projectService` 删除项目改为软删除：`deleted=true`
   - 新项目增加 `deleted=false`、`version=1`
   - 项目更新时递增 `version`
   - `precal_records` 新增 `deleted=false`、`version=1`
   - Pre-cal 更新、提交、撤销、SAP绑定、解锁、取消时递增 `version`
   - `precal_parameters` 新增 `deleted=false`、`version`

## 后续迁移到公司服务器时的改动点

理论上前端页面不需要大改，优先修改：

1. `miniprogram/config/env.js`
   - `mode: 'http'`
   - `httpBaseUrl: 'https://your-company-domain.com/api'`

2. `miniprogram/api/httpClient.js`
   - 按公司后端认证方式补充 token、session、header 等逻辑

3. 公司服务器实现与现有云函数 action 对应的 API
   - `projectService/list`
   - `projectService/detail`
   - `projectService/save`
   - `projectService/remove`
   - `precalService/createPrecal`
   - `precalService/updatePrecal`
   - `precalService/listMyPrecal`
   - `precalService/bindSap`
   - 等

## 尚未完成但建议后续继续加固

1. 月度快照 `monthlySnapshots` 还未实现。
2. 导出功能仍是项目模块 CSV，AUD Pre-cal 第一版未启用导出。
3. 旧项目集合的历史数据不会自动补 `deleted/version`，但新写入和新更新会补。
4. 如果正式接入公司服务器，需要重新设计登录态和 openid 绑定逻辑。
5. 如果后续涉及附件，需设计云存储 fileID 与公司文件存储 URL 的映射。

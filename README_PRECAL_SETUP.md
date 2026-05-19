# AUD Pre-cal v1 使用说明

## 本版本新增内容

1. 新增 Sales 端 AUD Pre-cal：创建、保存草稿、提交、撤销、重新提交。
2. 新增 CS 端 SAP 绑定：只显示 Submitted / SAP Bound，支持一个 Pre-cal 多个 SAP号，每个 SAP号下多个 item。
3. SAP item 默认按 1000、2000、3000 自动生成，并允许 CS 手动修改。
4. 至少保存一个 SAP号后，Pre-cal 自动变为 SAP Bound 并锁定主数据。
5. 新增 admin 端 Pre-cal 管理：查看全部、解锁 SAP Bound、维护参数。
6. 后端自行计算 AUD Pre-cal，并保存每条记录的参数快照。
7. 第一版未做导出功能。

## 需要创建的云数据库集合

请在云开发数据库中创建以下集合：

- precal_records
- precal_parameters
- precal_logs

已有 users 集合可以继续使用。本版本会兼容旧的 `role` 字段，并自动补充 `roles` 数组。

## 需要部署的云函数

右键以下云函数并选择“上传并部署：云端安装依赖”：

- login
- projectService
- precalService

其中 `precalService` 是本版本新增云函数。

## 用户角色设置

在 `users` 集合中给用户增加 `roles` 数组，例如：

```json
{
  "openid": "用户openid",
  "name": "用户姓名",
  "role": "pm",
  "roles": ["sales", "pm", "cs", "admin"],
  "active": true
}
```

常用角色：

- sales：可以创建和提交 AUD Pre-cal
- cs：可以检索 Submitted / SAP Bound 并绑定 SAP号
- admin：可以查看全部、解锁、维护参数
- pm：保留给原项目追踪表

## 参数初始化

第一次打开 Pre-cal 相关页面时，`precalService` 会自动在 `precal_parameters` 中创建一条 2026 AUD Pre-cal 默认参数。

默认参数来自已确认的 AUD Pre-cal 逻辑，包括：

- ESG hourlyRate = 681.98
- CSR hourlyRate = 532.25
- Travel MD = Onsite MD × 10%
- CSR allocation cost / Ext. sales 使用 P&L!E68 的修正值

注意：当前 Excel 中 Allocation cost / IC sales 行 D40:H40 为空，因此第一版计算中 IC sales allocation 组件按 Excel 现状为 0。参数中仍保留 Allocation / IC Sales 字段，方便以后确认后启用。

## 第一版流程

Sales：

Draft → Submitted → Withdrawn → Submitted → SAP Bound

CS：

只看 Submitted / SAP Bound，绑定 SAP 后状态变为 SAP Bound。

Admin：

SAP Bound 后如需修改主数据，由 admin 解锁为 Unlocked。


## v1.1 架构加固补充

本版本新增了：

- `miniprogram/config/env.js`
- `miniprogram/api/apiClient.js`
- `miniprogram/api/cloudbaseClient.js`
- `miniprogram/api/httpClient.js`
- `miniprogram/services/projectService.js`
- `miniprogram/services/precalService.js`
- `miniprogram/services/userService.js`

页面层已改为调用 services 层，不再直接调用 `wx.cloud.callFunction()`。当前仍使用 CloudBase，后续如迁移到公司服务器，优先从 `env.js` 和 `apiClient/httpClient` 开始调整。

# PM 项目成本、进度及绩效管理小程序

这是一个微信云开发小程序，用于管理项目预算工时、人员分配工时、AR 工时、成本进度绩效，并支持 Sales Pre-cal、CS SAP 绑定、PM 项目创建的基础流程。

## 主要功能

- 用户通过 openid 登录，`users.name` 作为项目 PM 和人员分配中的姓名来源。
- 首次使用如果姓名为空，需要在“我的”页填写姓名。
- PM 创建项目时，创建者自动成为项目 PM，并自动加入人员预算工时分配。
- 支持通过已绑定 SAP 项目号同步 Pre-cal 数据创建项目。
- Pre-cal 项目明细会按顺序导入为项目子项目，并保留对应 Item No. 与明细差旅费。
- 支持子项目预算、人员预算工时分配、AR 工时录入和自动指标预览。
- 支持 Sales 创建/提交 Pre-cal，CS 维护 SAP 号和 item，admin 查看和维护 Pre-cal。

## 启动方式

1. 用微信开发者工具导入项目根目录。
2. 确认 `miniprogram/config/env.js` 中的云环境配置正确。
3. 部署云函数：
   - `cloudfunctions/login`
   - `cloudfunctions/projectService`
   - `cloudfunctions/precalService`
4. 编译运行小程序。

## 使用流程

1. 首次进入小程序后，到“我的”页填写姓名。
2. admin 可在 `users` 集合中维护用户 `name` 和 `roles`；系统读取数据库中的最新姓名。
3. Sales 创建并提交 Pre-cal。
4. CS 在 SAP 绑定页维护 SAP 号和 item。
5. PM 通过业务页创建项目，可手动创建，也可输入 SAP 项目号同步 Pre-cal。
6. 在项目页维护子项目预算、人员预算工时分配、AR 工时和成本参数。

## 目录说明

```text
miniprogram/
  pages/                 小程序页面
  services/              前端服务封装
  utils/                 指标计算和工具函数
  api/                   CloudBase / HTTP 调用封装
  config/                环境和常量配置
cloudfunctions/
  login/                 登录、用户去重、姓名保存
  projectService/        项目创建、编辑、列表、导出
  precalService/         Pre-cal、SAP 绑定、参数维护
```

## 数据集合

- `users`：用户记录，关键字段包括 `openid`、`name`、`role`、`roles`。
- `projects`：项目记录，包含 PM、子项目、人员预算工时、AR 工时、指标结果。
- `precal_records`：Pre-cal 主数据、SAP 绑定、itemList、创建项目状态。
- `precal_parameters`：Pre-cal 参数。
- `precal_logs`：Pre-cal 操作日志。

## PM 和人员预算规则

- 谁创建项目，谁就是该项目 PM。
- 项目创建时写入 `pmOpenid`、`pmName`、`createdBy`、`createdByName`。
- `pmName` 来自 `users.name`，不是项目创建页手动输入。
- 当前 PM 会自动出现在人员预算工时分配中，默认预算工时为空。
- 项目组员输入只在确认、失焦或点击添加后解析，支持逗号、分号、顿号和换行分隔。

## 子项目默认值

- 默认子项目显示为“子项目 1”。
- 默认 `itemNo` / `subProjectNo` 为 `1000`。
- 子项目名称 `name` 默认留空，`1000` 不写入名称字段。
- 从 Pre-cal 导入时，项目明细 1/2/3 会生成子项目 1/2/3；Item No. 依次为 `1000`、`2000`、`3000`，明细差旅费写入对应子项目的差旅费字段。

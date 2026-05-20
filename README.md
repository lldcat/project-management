# PM 项目成本、进度及绩效管理小程序

这是一个可导入微信开发者工具的微信云开发版小程序代码包，用于替代项目复盘 Excel，并支持 **Pre-cal → SAP绑定 → 项目创建** 的全流程。

## 已实现功能（当前版本）

- 微信云开发初始化，默认环境 ID：`cloud1-6gwp2land6cda07f`
- 通过 openid 自动识别用户，云函数统一处理用户去重与角色合并
- 云函数统一处理项目增删改查，前端不直接操作数据库
- 支持 Sales 创建/提交 Pre-cal，CS 绑定 SAP，PM 通过 SAP 号创建项目
- PM 在“新增项目”页输入任一已绑定 SAP 号，可自动从 Pre-cal 创建完整项目
- 项目创建防重：同一个 Pre-cal 只能创建一个项目（通过 `createdProjectId` 防重）
- 子项目动态数组化（不写死 3 个），按 Pre-cal 绑定的 SAP 数量自动生成
- 首页看板：项目总数、风险项目、成本异常、进度滞后、BAC/AC/CV/SV 汇总
- 项目列表：搜索、风险筛选、编辑、删除、CSV 导出
- 项目填报页：基础信息、子项目预算、人员预算工时分配、差旅费、人天成本、AR 工时、自动计算预览

## 目录结构

```text
/workspace/project-management/
├─ miniprogram/
│  ├─ pages/
│  │  ├─ home/
│  │  ├─ projects/
│  │  ├─ edit/
│  │  ├─ precal/
│  │  ├─ precal-cs/
│  │  └─ admin/
│  ├─ services/
│  ├─ utils/
│  └─ config/
└─ cloudfunctions/
   ├─ login/
   ├─ projectService/
   └─ precalService/
```

## 云开发配置

### 1) 创建集合

当前版本至少需要以下集合：

- `users`
- `projects`
- `precal_records`
- `precal_parameters`
- `precal_logs`

### 2) 上传云函数

在微信开发者工具中右键以下云函数文件夹，选择“上传并部署：云端安装依赖”：

- `cloudfunctions/login`
- `cloudfunctions/projectService`
- `cloudfunctions/precalService`

### 3) 数据库安全规则建议

前端不直接读写数据库，建议生产环境集合权限收紧：

```json
{
  "read": false,
  "write": false
}
```

## 角色与权限（已更新）

### 默认用户角色

首次登录时，系统会自动创建用户并赋予测试用全能角色：

```json
{
  "role": "admin",
  "roles": ["pm", "sales", "cs", "admin", "ar"]
}
```

> 说明：当前代码中 **已移除 leader 角色** 的运行时权限判断。

### 权限口径

| 角色 | 权限 |
|---|---|
| pm | 创建并维护自己项目 |
| sales | 创建/编辑/提交 Pre-cal |
| cs | 维护 Pre-cal 的 SAP 绑定 |
| admin | 管理视角（查看全部项目；可编辑/删除）与参数维护 |
| ar | 查看全部项目（兼容旧角色） |
| member | 预留角色 |

## Pre-cal → 项目创建流程（当前实现）

1. CS 在 Pre-cal 中绑定多个 SAP（`sapBindings[].sapNo`）。
2. PM 在“新增项目”页输入任一 SAP 号。
3. `projectService.createFromSap` 在 `precal_records` 中按 SAP 反查对应 Pre-cal。
4. 若未找到，提示：`未找到该 SAP 项目号对应的 Pre-cal`。
5. 若已存在 `createdProjectId`，提示：`该项目已存在，请勿重复创建`。
6. 若可创建：
   - `mainSapNo = 输入SAP号`
   - `sapNumbers = 该 Pre-cal 绑定的全部 SAP`
   - `subProjects` 按 `sapNumbers` 动态生成
   - `budgetTotalHours = totalMD * 8`
   - `projectTotalBudget = orderValue - travelFee`
   - `bac = projectTotalBudget`
7. 创建成功后回写 Pre-cal：`createdProjectId`，并更新状态为 `Project Created`。

## 当前计算口径

### 项目总预算（BAC）

```text
BAC = projectTotalBudget = Order Value - 差旅费
```

### 预算总工时

```text
budgetTotalHours = Total MD × 8
```

### 挣值指标（项目复盘页）

```text
PV = BAC × 计划完成率
EV = BAC × 实际完成率
AC = ΣAR工时 ÷ 8 × 内部人天成本
CV = EV - AC
SV = EV - PV
CPI = EV ÷ AC
SPI = EV ÷ PV
```

## 备注

- 旧文档中的 leader 说明已废弃，以本 README 为准。
- 如果你要从历史数据迁移，请确保旧用户记录中的 `leader` 不再作为权限依赖角色。

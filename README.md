# PM 项目成本、进度及绩效管理小程序

这是一个可导入微信开发者工具的微信云开发版小程序代码包，用于替代项目复盘 Excel，并支持 **Pre-cal → SAP 绑定 → 项目创建** 的全流程。

## 已实现功能（当前版本）

- 微信云开发初始化，默认环境 ID：`cloud1-6gwp2land6cda07f`
- 通过 openid 自动识别用户，云函数统一处理用户去重与角色合并
- 云函数统一处理项目增删改查，避免前端直接操作数据库
- 默认每个用户都是 PM，可创建、查看和编辑自己负责的项目
- 支持 Sales 创建/提交 Pre-cal，CS 绑定 SAP，PM 通过 SAP 号创建项目
- PM 在“新增项目”页输入任一已绑定 SAP 号，可自动从 Pre-cal 创建完整项目
- 项目创建防重：同一个 Pre-cal 只能创建一个项目（通过 `createdProjectId` 防重）
- 子项目动态数组化，不固定 3 个子项目，可按 Pre-cal 绑定的 SAP 数量动态生成
- 支持人员预算工时分配，并与每位员工 AR 工时逐人比较
- 支持 PM 手动录入 AR 工时
- 首页看板：项目总数、风险项目、成本异常、进度滞后、BAC（项目总预算）/AC（实际成本）/CV（成本偏差）/SV（进度偏差）汇总
- 项目列表：搜索、风险筛选、新增、编辑、删除、CSV 导出
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
| pm | 创建并维护自己负责的项目 |
| sales | 创建、编辑、提交 Pre-cal |
| cs | 维护 Pre-cal 的 SAP 绑定 |
| admin | 管理视角，查看全部项目，可编辑、删除，并维护系统参数 |
| ar | 查看全部项目，兼容旧角色 |
| member | 预留角色，当前按普通 PM 逻辑处理 |

管理员看全部项目的启用方式：先用管理员微信打开一次小程序，让系统在 `users` 集合生成该用户记录；然后在 `users` 集合中找到该用户，把 `role` 设置为 `admin`，并确认 `roles` 中包含 `admin`，保存后重新进入小程序即可。首页和项目页会显示当前角色及可见范围。

## Pre-cal → 项目创建流程（当前实现）

1. Sales 创建并提交 Pre-cal。
2. CS 在 Pre-cal 中绑定一个或多个 SAP 项目号（`sapBindings[].sapNo`）。
3. PM 在“新增项目”页输入任一已绑定 SAP 项目号。
4. `projectService.createFromSap` 在 `precal_records` 中按 SAP 项目号反查对应 Pre-cal。
5. 若未找到，提示：`未找到该 SAP 项目号对应的 Pre-cal`。
6. 若该 Pre-cal 已存在 `createdProjectId`，提示：`该项目已存在，请勿重复创建`。
7. 若可创建：
   - `mainSapNo = 输入的 SAP 项目号`
   - `sapNumbers = 该 Pre-cal 绑定的全部 SAP 项目号`
   - `subProjects` 按 SAP 绑定数量动态生成
   - 子项目号依次为 `1000`、`2000`、`3000` 等
   - `budgetTotalHours = Total MD × 8`
   - `projectTotalBudget = Order Value - 差旅费`
   - `bac = projectTotalBudget`
8. 创建成功后回写 Pre-cal：`createdProjectId`，并更新状态为 `Project Created`。

## 人员预算工时分配

本版使用 `employeeBudgets` 字段记录每个员工被分配的项目预算工时：

```json
{
  "employeeBudgets": [
    { "memberName": "张三", "budgetHours": 24 },
    { "memberName": "李四", "budgetHours": 16 }
  ]
}
```

系统会自动比较：

```text
人员预算工时合计 = Σ每位员工分配预算工时
人员预算分配差异 = 人员预算工时合计 - 子项目预算工时合计
个人预算使用率 = 个人 AR 工时 ÷ 个人分配预算工时
个人剩余/超出工时 = 个人分配预算工时 - 个人 AR 工时
```

如果某位员工的 AR 工时超过个人预算工时，或有 AR 工时但没有分配预算，系统会在异常提醒中标出。

## 人员预算与 AR 成员同步规则

- 项目经理 PM 必须填写，并会自动进入“人员预算工时分配”和“AR 工时”。
- “项目组员”支持用逗号、顿号、空格或换行分隔；点击“同步 PM/组员”后，会把 PM 和项目组员同步到人员预算。
- “AR 工时”的成员名单不能单独新增或删除，系统自动与“人员预算工时分配”保持一致；如需增减成员，请先调整人员预算。
- 修改人员预算里的员工姓名时，AR 工时成员会同步更新，并尽量保留同名员工原有 AR 工时。
- 保存时云函数会再次校验并同步，避免前端异常导致人员预算和 AR 工时成员不一致。

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


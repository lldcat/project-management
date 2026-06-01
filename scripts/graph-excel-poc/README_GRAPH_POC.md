# Microsoft Graph Excel API POC

本目录是一个独立的 Node.js 最小验证模块，用于确认公司 OneDrive for Business 中的 AR Excel workbook 是否可以通过 Microsoft Graph Excel API 被程序读取和写入。

该 POC 只放在 `scripts/graph-excel-poc/` 下，不修改现有微信小程序页面、云函数、Pre-cal、项目追踪或 SAP 绑定等业务功能。

## 验证内容

脚本会按顺序执行以下动作：

1. 使用 Azure AD client credentials 获取 Microsoft Graph access token。
2. 调用 `workbook/createSession`，并使用 `persistChanges: true` 创建 persistent session。
3. 后续 workbook 读写请求全部携带 `workbook-session-id` header。
4. 获取 workbook worksheets 列表并打印所有 sheet 名称。
5. 读取配置的员工 sheet，例如 `Zhang Bailiang`。
6. 读取员工 sheet 的 `A8:R20`。
7. 打印第 8 行表头，以及第 9 行以后的数据。
8. 自动创建或复用测试 sheet：`Graph_Test`。
9. 只向 `Graph_Test!A1:D5` 写入测试数据。
10. 再读取 `Graph_Test!A1:D5`，确认写入内容一致。
11. 脚本结束前关闭 workbook session。

## 前置条件

- Node.js 18 或更高版本。本脚本使用 Node 内置 `fetch`，不需要安装 npm 依赖。
- Azure App Registration 位于公司 OneDrive for Business 文件所在 tenant。
- Microsoft Graph application permission 已配置并完成 admin consent，例如 `Files.ReadWrite.All` 或 `Sites.ReadWrite.All`。
- 已拿到目标 Excel 文件的 Microsoft Graph `driveId` 和 `itemId`。

## 环境变量配置

复制示例文件后，在本地填写真实配置：

```bash
cp scripts/graph-excel-poc/.env.example scripts/graph-excel-poc/.env
```

必填环境变量：

| 变量 | 说明 |
| --- | --- |
| `MS_TENANT_ID` | Azure AD tenant id。 |
| `MS_CLIENT_ID` | Azure App Registration application/client id。 |
| `MS_CLIENT_SECRET` | Azure App Registration client secret。不要提交真实 secret。 |
| `MS_DRIVE_ID` | OneDrive for Business 文档库的 Microsoft Graph drive id。 |
| `MS_ITEM_ID` | 目标 Excel workbook 的 Microsoft Graph item id。 |
| `MS_WORKSHEET_NAME` | 需要读取的员工 sheet，例如 `Zhang Bailiang`。 |

也可以不使用 `.env`，直接在 shell 中 export 上述变量。

## 运行方式

在仓库根目录执行：

```bash
node scripts/graph-excel-poc/graph-excel-poc.js
```

查看帮助，不需要配置环境变量：

```bash
node scripts/graph-excel-poc/graph-excel-poc.js --help
```

## 预期输出

成功运行时会输出：

- 是否成功获取 token。
- 是否成功创建 persistent workbook session。
- 是否成功读取 workbook worksheets。
- worksheets 列表。
- 是否成功读取指定员工 sheet 的 `A8:R20`。
- 第 8 行表头。
- 第 9 行以后数据。
- 是否成功写入 `Graph_Test!A1:D5`。
- 是否成功读取并确认 `Graph_Test!A1:D5` 写入结果。
- 是否成功关闭 workbook session。

## 安全说明

- 代码中不写死任何 client secret。
- 脚本不会打印 `MS_CLIENT_SECRET`。
- 脚本不会写入正式员工 AR sheet 的可见区域。
- 唯一写入目标是测试 sheet `Graph_Test!A1:D5`。
- 该模块仅用于 POC，不做完整同步。
- `.gitignore` 已忽略 `scripts/graph-excel-poc/.env`，避免误提交本地 secret。

## 常见排查方向

脚本失败时会输出 Graph error code、HTTP status、request id（如果 Graph 返回）、Retry-After（如果 Graph 返回）以及下一步排查建议。

常见原因：

- `401` 或 `403`：Graph 权限不足、未完成 admin consent、client secret 无效或 tenant 不匹配。
- `404`：`MS_DRIVE_ID` 或 `MS_ITEM_ID` 不正确，workbook 被移动/删除，或员工 sheet 名称拼写不一致。
- `429`：Microsoft Graph 限流，请等待 `Retry-After` 后重试并降低请求频率。
- session 相关错误：确认 `workbook/createSession` 成功，且后续 workbook 请求都带有 `workbook-session-id`。

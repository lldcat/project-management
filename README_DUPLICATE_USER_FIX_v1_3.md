# v1.3 用户重复记录修复说明

本版本修复 `users` 集合中同一个 openid 可能被创建多条记录的问题。

## 修改范围

已修改以下云函数：

- `cloudfunctions/login/index.js`
- `cloudfunctions/projectService/index.js`
- `cloudfunctions/precalService/index.js`

## 修复逻辑

1. 查询用户时同时匹配 `openid` 和 `_openid`。
2. 若同一 openid 已存在多条用户记录：
   - 自动选择一条主记录；
   - 合并角色、姓名、默认人天成本等关键字段；
   - 删除其余重复用户记录。
3. 新用户创建时不再使用 `users.add()` 随机生成 `_id`，而是使用 `users.doc(openid).set()`，让新用户的 `_id` 固定为 openid。
4. 这样可以避免小程序启动、首页、工作台或多个云函数并发初始化用户时重复新增用户记录。

## 部署后需要做什么

请重新上传并部署以下 3 个云函数，建议选择“云端安装依赖”：

- `login`
- `projectService`
- `precalService`

部署完成后，用同一个微信账号重新打开一次小程序。该账号下一次触发登录或访问项目/Pre-cal 功能时，重复的 `users` 记录会被自动清理。

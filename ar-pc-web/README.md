# AR PC Web

独立 PC Web AR 工时填报系统（不依赖微信小程序/云开发）。

## 启动

```bash
cd ar-pc-web
npm install
npm run dev
```

- 前端: http://localhost:5173
- 后端: http://localhost:3001

## 功能

- 类 Excel AR 填报（增删行、单元格编辑、批量保存）
- Total Time 自动计算且只读
- 按默认 SAP + Task 自动带出 Item No.
- 按月份、员工、SAP、Client、Record Type 筛选
- Excel 导入预览与校验（不直接入库）
- Excel 导出（10 个正式字段）并将记录标记为已导出
- employee 只能编辑自己的数据；已导出记录普通员工不可编辑
- admin 可查看全部并维护用户默认 SAP

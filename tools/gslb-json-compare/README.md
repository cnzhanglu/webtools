# GSLB 多文件对比（gslb-json-compare）

## 功能
- 多个 GSLB JSON 横向比对状态字段
- 唯一键：域名+类型+数据中心+成员名称+成员IP
- 支持文件重命名、结果过滤、Excel 导出

## 模块逻辑
1. `app.js/onFilesSelected` 读取多文件 JSON
2. `process.js/extractRows` 标准化成 rowMap
3. `process.js/buildComparison` 按唯一键对齐并判定一致/不一致/缺失
4. `app.js/renderTable + applyFilter` 预览过滤
5. `app.js/exportExcel` 调 `BocXlsx.generate` 导出


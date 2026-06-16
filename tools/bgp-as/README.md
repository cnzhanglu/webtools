# BGP AS 号转换（bgp-as）

## 功能
- ASPlain 与 ASDOT/ASDOT+ 互转
- 批量转换并标注号段范围

## 模块逻辑
1. `app.js/doConvert` 逐行读取输入
2. `parseAS` 识别 plain/dot 形式
3. `toDot/toDisplayDot` 输出目标格式
4. `asRange` 标注公有/私有/保留范围
5. `renderTable` 展示结果


# Excel 切换 JSON（excel2json，定制工具）

## 功能
- 上传 xlsx（A/D/E/F/G 列）
- 按应用名生成动态/静态“切换 + 回切”JSON
- 支持 IPv4/IPv6、错误定位（行列）、批量下载

## 模块逻辑
1. `app.js/onFileSelected` 读取 xlsx ArrayBuffer
2. `shared/xlsx-read.js/parse` 解析 sheet + mergeCells 回填
3. `process.js/run` 跳过标题行并按 A 列分组
4. `validate.js` 校验域名、单IP/多IP、静态换行规则
5. `process.js`
   - 动态：`setDiff(E,F)` 生成 `address/new_address`
   - 静态：E/F 单值映射，回切互换
   - 防空：静态两侧不能都空；动态差分后不能两侧都空
6. `app.js/renderFileList/selectItem` 预览并支持单个/全部下载


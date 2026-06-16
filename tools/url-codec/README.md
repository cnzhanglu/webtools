# URL 编解码（url-codec）

## 功能
- 支持 `encodeURIComponent` / `encodeURI` / 表单模式
- 单行与批量编解码
- 差异高亮显示

## 模块逻辑
1. `doProcess` 处理单行输入
2. `encode/decode` 按模式转换
3. `renderDiff` 标记变化片段
4. `batchProcess` 做多行批处理


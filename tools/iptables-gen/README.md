# iptables 规则生成（iptables-gen）

## 功能
- 模板化生成 IPv4/IPv6 iptables 规则
- 支持白名单、前缀策略、已有规则导入识别
- 支持规则校验、项目保存/加载

## 模块逻辑
1. `template.js` 提供默认模板与规则结构
2. `store.js` 管理项目/设备/栈数据持久化
3. `parse.js/parseRules` 导入现有规则并结构化
4. `validate.js/validateRulesText` 校验规则合法性
5. `generate.js/generateStack` 生成最终命令文本
6. `app.js` 负责 UI 编排与导入导出流程


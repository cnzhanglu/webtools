# Punycode 域名编解码（punycode-tool）

## 功能
- Unicode 域名与 ACE(`xn--`) 互转
- 支持自动识别方向、批量处理

## 模块逻辑
1. `punycode.js` 实现 RFC3492：`encodeLabel/decodeLabel`
2. `encodeDomain/decodeDomain` 做域名级转换
3. `app.js/processInput` 批量调用并收集错误
4. `renderTable` 展示与复制


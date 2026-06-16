# Base64 编解码（base64-tool）

## 功能
- 文本编码/解码
- 文件转 Base64 文本
- Base64 还原文件下载

## 模块逻辑
1. 文本流程：`textEncode/textDecode`
2. 文件编码：`onFileSelected -> encodeFile -> saveB64AsTxt`
3. 文件解码：`onB64FileSelected -> decodeToFile`
4. 核心转换函数：`uint8ToBase64/base64ToUint8`


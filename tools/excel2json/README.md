# Excel 切换 JSON（excel2json，定制工具）

## 功能
- 上传 xlsx（A/D/E/F/G 列）
- 按应用名生成动态/静态“切换 + 回切”JSON
- 动态类型上传 GSLB 全量 JSON，按域名与 IP 生成 `modify gslb service-member`
- 静态类型上传 DNS ZIP，按 `auth-zones.csv` 最细权威区生成 `modify rrs`
- 为切换和回切分别生成应急命令 TXT
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
7. `gslb-lookup.js` 按 `ADD → gpool_list → gpool.gmember_list` 建立域名/IP 成员索引
8. `dns-lookup.js` 解压 DNS ZIP、解析 `auth-zones.csv`，按标签边界最长后缀匹配权威区
9. `emergency-cmd.js`
   - 动态：`address` 对应成员生成 `status disable`，`new_address` 生成 `status enable`
   - 静态：`address/new_address` 生成 `rdata/new_rdata`，每个文件用 `.dns` 与 `quit` 包裹
   - 静态完整域名强制带尾点；IPv4 使用 `type a`，IPv6 使用 `type aaaa`
   - 回切沿用已互换的 `revertData`
   - 未匹配动态成员、静态权威区或静态任一侧 IP 为空时跳过并警告

## 动态应急命令格式

```text
modify gslb service-member datacenter-name <dc_name> member-name <gmember_name> status disable
modify gslb service-member datacenter-name <dc_name> member-name <gmember_name> status enable
```

`member-name` 使用 GSLB JSON 中的 `gmember_name` 名称，不使用 `real_id`。

## 静态应急命令格式

```text
.dns
modify rrs view default zone mbs.boc.cn name asdk.mbs.boc.cn. type a rdata 1.1.1.1 new_rdata 2.2.2.2
quit
```

视图和区名称来自 DNS ZIP 内 `auth-zones.csv` 的 A/B 列；域名同时命中父区与子区时选择标签数最多的最细区。

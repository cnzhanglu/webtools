// 静态站点嵌入：构建前由 scripts/sync-static.sh 同步仓库根到 site/。
package static

import "embed"

//go:embed site/*
var Site embed.FS

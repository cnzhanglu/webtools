/**
 * 工具箱本地服务入口
 *
 * 解析 CLI 参数，注册后台服务占位，启动 embed 静态站点 HTTP 服务。
 */
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os/exec"
	"runtime"
	"time"

	"github.com/cnzhanglu/webtools/server/internal/app"
	"github.com/cnzhanglu/webtools/server/internal/service"
)

// version 由构建脚本通过 -ldflags 注入。
var version = "dev"

func main() {
	host := flag.String("host", "127.0.0.1", "监听地址")
	port := flag.Int("port", 8080, "监听端口")
	openBrowser := flag.Bool("open", false, "启动后打开系统默认浏览器")
	showVersion := flag.Bool("version", false, "打印版本并退出")
	flag.Parse()

	if *showVersion {
		fmt.Println(version)
		return
	}

	registry := &service.Registry{}
	registry.Register(service.NewNoop())

	opts := app.Options{
		Host:    *host,
		Port:    *port,
		Version: version,
	}

	if *openBrowser {
		url := fmt.Sprintf("http://%s:%d", *host, *port)
		go func() {
			time.Sleep(300 * time.Millisecond)
			if err := openBrowserURL(url); err != nil {
				log.Printf("无法自动打开浏览器: %v（请手动访问 %s）", err, url)
			}
		}()
	}

	if err := app.Run(context.Background(), opts, registry); err != nil {
		log.Fatal(err)
	}
}

func openBrowserURL(url string) error {
	switch runtime.GOOS {
	case "linux":
		return exec.Command("xdg-open", url).Start()
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		return exec.Command("open", url).Start()
	default:
		return fmt.Errorf("不支持的平台 %s", runtime.GOOS)
	}
}

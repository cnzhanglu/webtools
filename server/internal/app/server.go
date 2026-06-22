/**
 * HTTP 服务组装
 *
 * 启动顺序：后台 Service → /api 路由 → 静态文件；
 * 收到 SIGINT/SIGTERM 后优雅关闭并逆序 Stop 后台服务。
 */
package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path"
	"strings"
	"syscall"
	"time"

	"github.com/cnzhanglu/webtools/server/internal/api"
	"github.com/cnzhanglu/webtools/server/internal/service"
	"github.com/cnzhanglu/webtools/server/internal/static"
)

// Options 服务启动参数。
type Options struct {
	Host    string
	Port    int
	Version string
}

// Run 启动 HTTP 服务并阻塞至收到退出信号。
func Run(ctx context.Context, opts Options, registry *service.Registry) error {
	if registry == nil {
		registry = &service.Registry{}
	}

	if err := registry.StartAll(ctx); err != nil {
		return err
	}

	siteFS, err := fs.Sub(static.Site, "site")
	if err != nil {
		_ = registry.StopAll(ctx)
		return fmt.Errorf("打开嵌入静态目录失败: %w", err)
	}

	mux := http.NewServeMux()
	mux.Handle("/api/", api.NewMux(opts.Version))
	mux.Handle("/", newStaticHandler(siteFS))

	addr := fmt.Sprintf("%s:%d", opts.Host, opts.Port)
	server := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		_ = registry.StopAll(ctx)
		return fmt.Errorf("监听 %s 失败: %w", addr, err)
	}

	errCh := make(chan error, 1)
	go func() {
		log.Printf("工具箱本地服务已启动: http://%s", ln.Addr().String())
		errCh <- server.Serve(ln)
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	select {
	case <-ctx.Done():
	case sig := <-sigCh:
		log.Printf("收到信号 %s，正在关闭…", sig)
	case err := <-errCh:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			_ = registry.StopAll(ctx)
			return err
		}
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("HTTP 关闭异常: %v", err)
	}

	if err := registry.StopAll(shutdownCtx); err != nil {
		return err
	}
	return nil
}

// newStaticHandler 提供目录 index.html，与 Cloudflare 目录 URL 行为一致。
func newStaticHandler(siteFS fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(siteFS))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		urlPath := r.URL.Path
		if urlPath == "" || urlPath == "/" {
			serveSiteFile(w, r, siteFS, "index.html")
			return
		}

		clean := strings.TrimPrefix(path.Clean(urlPath), "/")
		info, err := fs.Stat(siteFS, clean)
		if err == nil && info.IsDir() {
			if !strings.HasSuffix(urlPath, "/") {
				target := urlPath + "/"
				if r.URL.RawQuery != "" {
					target += "?" + r.URL.RawQuery
				}
				http.Redirect(w, r, target, http.StatusMovedPermanently)
				return
			}
			serveSiteFile(w, r, siteFS, path.Join(clean, "index.html"))
			return
		}

		if err != nil {
			indexPath := path.Join(strings.TrimSuffix(clean, "/"), "index.html")
			if hasFile(siteFS, indexPath) {
				serveSiteFile(w, r, siteFS, indexPath)
				return
			}
		}

		fileServer.ServeHTTP(w, r)
	})
}

func serveSiteFile(w http.ResponseWriter, r *http.Request, siteFS fs.FS, name string) {
	f, err := siteFS.Open(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()

	stat, err := f.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}

	seeker, ok := f.(io.ReadSeeker)
	if !ok {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	http.ServeContent(w, r, path.Base(name), stat.ModTime(), seeker)
}

func hasFile(siteFS fs.FS, name string) bool {
	_, err := fs.Stat(siteFS, name)
	return err == nil
}

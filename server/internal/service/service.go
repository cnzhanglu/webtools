/**
 * 后台服务注册表
 *
 * 为后续定时任务、文件监听、内网代理等预留统一生命周期：
 * 应用启动时 StartAll，收到退出信号时 StopAll。
 */
package service

import (
	"context"
	"fmt"
	"sync"
)

// BackgroundService 后台服务接口，实现方须保证 Start 可重复调用前已 Stop。
type BackgroundService interface {
	Name() string
	Start(ctx context.Context) error
	Stop(ctx context.Context) error
}

// Registry 维护已注册的后台服务并按序启停。
type Registry struct {
	mu       sync.Mutex
	services []BackgroundService
}

// Register 追加一个后台服务（通常在 main 中注册）。
func (r *Registry) Register(svc BackgroundService) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.services = append(r.services, svc)
}

// StartAll 按注册顺序启动全部服务。
func (r *Registry) StartAll(ctx context.Context) error {
	r.mu.Lock()
	list := append([]BackgroundService(nil), r.services...)
	r.mu.Unlock()

	for _, svc := range list {
		if err := svc.Start(ctx); err != nil {
			return fmt.Errorf("启动服务 %s 失败: %w", svc.Name(), err)
		}
	}
	return nil
}

// StopAll 按注册逆序停止全部服务。
func (r *Registry) StopAll(ctx context.Context) error {
	r.mu.Lock()
	list := append([]BackgroundService(nil), r.services...)
	r.mu.Unlock()

	var firstErr error
	for i := len(list) - 1; i >= 0; i-- {
		if err := list[i].Stop(ctx); err != nil && firstErr == nil {
			firstErr = fmt.Errorf("停止服务 %s 失败: %w", list[i].Name(), err)
		}
	}
	return firstErr
}

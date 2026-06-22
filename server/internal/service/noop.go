package service

import "context"

// noopService 占位实现，保证注册表在无真实后台服务时仍可正常启停。
type noopService struct{}

func (noopService) Name() string { return "noop" }

func (noopService) Start(ctx context.Context) error { return nil }

func (noopService) Stop(ctx context.Context) error { return nil }

// NewNoop 返回一个空后台服务，供默认注册使用。
func NewNoop() BackgroundService { return noopService{} }

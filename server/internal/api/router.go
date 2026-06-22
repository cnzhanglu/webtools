package api

import (
	"encoding/json"
	"net/http"
)

// NewMux 注册 /api 下路由（挂载时配合 StripPrefix 使用）。
func NewMux(version string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth(version))
	mux.HandleFunc("/", handleNotFound)
	return http.StripPrefix("/api", mux)
}

func handleNotFound(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusNotFound)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error": "not found",
	})
}

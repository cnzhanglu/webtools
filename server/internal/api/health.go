package api

import (
	"encoding/json"
	"net/http"
)

// healthResponse /api/health 返回体。
type healthResponse struct {
	Status  string `json:"status"`
	Version string `json:"version"`
}

// handleHealth 返回服务存活与版本信息。
func handleHealth(version string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(healthResponse{
			Status:  "ok",
			Version: version,
		})
	}
}

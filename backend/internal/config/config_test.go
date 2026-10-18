package config

import (
	"strings"
	"testing"
)

func TestProductionChecks(t *testing.T) {
	strong := Config{
		AdminPassword: "Zq7mN2pX9vB4kL8wR1tY",
		DatabaseURL:   "postgres://photobook:Hk3pQ9zLm2Vx7Rt5Wn8Y@postgres:5432/photobook",
		AppBaseURL:    "https://sakta.kz",
		S3:            S3Config{SecretKey: "Fj4kT8mQ2xZ7pL9wN3vB"},
	}
	if err := checkProduction(strong); err != nil {
		t.Fatalf("strong config refused: %v", err)
	}

	weak := Config{
		AdminPassword: "admin123",
		DatabaseURL:   "postgres://photobook:photobook@postgres:5432/photobook",
		AppBaseURL:    "http://localhost:5173",
		S3:            S3Config{SecretKey: "photobooksecret"},
	}
	err := checkProduction(weak)
	for _, want := range []string{"ADMIN_PASSWORD", "S3_SECRET_KEY", "database password", "https"} {
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("weak config: error %v should mention %q", err, want)
		}
	}
}

package index

import (
	"context"
	"io/fs"
	"log/slog"
	"slices"
	"testing"
	"testing/fstest"
)

func TestSearch(t *testing.T) {
	ix := New(fstest.MapFS{
		"Photos/2024/beach.jpg":     {},
		"Photos/2024/Beach day.png": {},
		"Photos/.thumbs/beach.jpg":  {},
		"Docs/my beach notes.md":    {},
		"Docs/report.pdf":           {},
		"beach":                     {Mode: fs.ModeDir | 0o755},
		".hidden/beach.txt":         {},
	}, func() bool { return false }, nil, slog.New(slog.DiscardHandler))
	ix.Scan(context.Background())

	tests := []struct {
		scope, query string
		limit        int
		want         []string
		total        int
	}{
		// Exact name first, then prefix matches, then the rest in walk order.
		{".", "BEACH", 10, []string{"beach", "Photos/2024/Beach day.png", "Photos/2024/beach.jpg", "Docs/my beach notes.md"}, 4},
		{".", "beach  notes", 10, []string{"Docs/my beach notes.md"}, 1},
		{"Photos", "beach", 10, []string{"Photos/2024/Beach day.png", "Photos/2024/beach.jpg"}, 2},
		{"Photos/2024", "beach", 10, []string{"Photos/2024/Beach day.png", "Photos/2024/beach.jpg"}, 2},
		{"Photo", "beach", 10, nil, 0}, // scope is a folder, not a prefix
		{"Docs/report.pdf", "beach", 10, nil, 0},
		{"Nope", "beach", 10, nil, 0},
		{".", "beach", 1, []string{"beach"}, 4},
		{".", "  ", 10, nil, 0},
		{".", "thumbs", 10, nil, 0},
	}
	for _, tt := range tests {
		got, total := ix.Search(tt.scope, tt.query, tt.limit)
		if !slices.Equal(got, tt.want) || total != tt.total {
			t.Errorf("Search(%q, %q, %d) = %q, %d; want %q, %d", tt.scope, tt.query, tt.limit, got, total, tt.want, tt.total)
		}
	}

	if s := ix.Status(); s.Entries != 8 || s.ScannedAt.IsZero() || s.Scanning {
		t.Errorf("status %+v", s)
	}
}

func TestShowHidden(t *testing.T) {
	show := false
	ix := New(fstest.MapFS{"a.txt": {}, ".git/config": {}, ".env": {}}, func() bool { return show }, nil, slog.New(slog.DiscardHandler))
	ix.Scan(context.Background())
	if got, _ := ix.Search(".", "e", 10); len(got) != 0 {
		t.Errorf("hidden: found %q", got)
	}
	show = true
	ix.Scan(context.Background())
	if got, _ := ix.Search(".", "g", 10); !slices.Equal(got, []string{".git", ".git/config"}) {
		t.Errorf("shown: found %q", got)
	}
}

func TestSkip(t *testing.T) {
	ix := New(fstest.MapFS{
		"proc/1/status":       {},
		"var/lib/docker/a.go": {},
		"var/log/a.log":       {},
		"a.txt":               {},
	}, func() bool { return false }, func() []string { return []string{"proc", "var/lib/docker"} }, slog.New(slog.DiscardHandler))
	ix.Scan(context.Background())
	if got, _ := ix.Search(".", "a", 10); !slices.Equal(got, []string{"a.txt", "var/log/a.log", "var"}) {
		t.Errorf("found %q", got)
	}
}

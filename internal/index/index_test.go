package index

import (
	"context"
	"io/fs"
	"log/slog"
	"slices"
	"testing"
	"testing/fstest"
)

func paths(es []Entry) []string {
	var ps []string
	for _, e := range es {
		ps = append(ps, e.Path)
	}
	return ps
}

func TestSearch(t *testing.T) {
	ix := New(fstest.MapFS{
		"Photos/2024/beach.jpg":     {},
		"Photos/2024/Beach day.png": {},
		"Photos/.thumbs/beach.jpg":  {},
		"Docs/my beach notes.md":    {},
		"Docs/report.pdf":           {},
		"beach":                     {Mode: fs.ModeDir | 0o755},
		".hidden/beach.txt":         {},
	}, func() bool { return false }, slog.New(slog.DiscardHandler))
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
		{"Photo", "beach", 10, nil, 0}, // scope is a folder, not a prefix
		{".", "beach", 1, []string{"beach"}, 4},
		{".", "  ", 10, nil, 0},
		{".", "thumbs", 10, nil, 0},
	}
	for _, tt := range tests {
		got, total := ix.Search(tt.scope, tt.query, tt.limit)
		if !slices.Equal(paths(got), tt.want) || total != tt.total {
			t.Errorf("Search(%q, %q, %d) = %q, %d; want %q, %d", tt.scope, tt.query, tt.limit, paths(got), total, tt.want, tt.total)
		}
	}

	if s := ix.Status(); s.Entries != 8 || s.ScannedAt.IsZero() || s.Scanning {
		t.Errorf("status %+v", s)
	}
}

func TestShowHidden(t *testing.T) {
	show := false
	ix := New(fstest.MapFS{"a.txt": {}, ".git/config": {}, ".env": {}}, func() bool { return show }, slog.New(slog.DiscardHandler))
	ix.Scan(context.Background())
	if got, _ := ix.Search(".", "e", 10); len(got) != 0 {
		t.Errorf("hidden: found %q", paths(got))
	}
	show = true
	ix.Scan(context.Background())
	if got, _ := ix.Search(".", "g", 10); !slices.Equal(paths(got), []string{".git", ".git/config"}) {
		t.Errorf("shown: found %q", paths(got))
	}
}

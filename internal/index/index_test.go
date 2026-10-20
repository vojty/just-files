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
	}, slog.New(slog.DiscardHandler))
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

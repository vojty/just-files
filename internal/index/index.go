// Package index keeps an in-memory list of every file and folder under the
// root, so searches filter a slice instead of walking the disk. The list is
// rebuilt by a full walk at startup, periodically, and shortly after the
// server changes something (see Refresh).
package index

import (
	"context"
	"errors"
	"io/fs"
	"log/slog"
	"path"
	"slices"
	"strings"
	"sync"
	"time"

	"just-files/internal/fileinfo"
)

// Entry is a file or folder found by a scan.
type Entry struct {
	Path    string // slash-separated, relative to the root
	Name    string
	IsDir   bool
	Size    int64
	ModTime time.Time
	Mode    fs.FileMode
	Owner   string
	Group   string

	lower string // lower-case Name, for matching
}

// Status describes the last scan.
type Status struct {
	Entries   int
	ScannedAt time.Time // zero until the first scan finished
	Took      time.Duration
	Scanning  bool
}

// Index is a searchable snapshot of the root.
type Index struct {
	fsys       fs.FS
	showHidden func() bool
	logger     *slog.Logger

	refresh chan struct{}

	mu       sync.RWMutex
	entries  []Entry
	status   Status
	scanning bool
}

// New returns an empty index of fsys; call Run to fill it. Hidden (dot)
// files and folders are indexed while showHidden reports true; call Refresh
// when that changes.
func New(fsys fs.FS, showHidden func() bool, logger *slog.Logger) *Index {
	return &Index{fsys: fsys, showHidden: showHidden, logger: logger, refresh: make(chan struct{}, 1)}
}

// refreshDelay batches the rescans requested by bursts of changes, such as
// a folder upload.
const refreshDelay = time.Second

// Run scans the root, then again every interval (0: never) and after
// Refresh, until ctx ends.
func (ix *Index) Run(ctx context.Context, interval time.Duration) {
	var tick <-chan time.Time
	if interval > 0 {
		t := time.NewTicker(interval)
		defer t.Stop()
		tick = t.C
	}
	for {
		ix.Scan(ctx)
		select {
		case <-ctx.Done():
			return
		case <-tick:
		case <-ix.refresh:
			select {
			case <-ctx.Done():
				return
			case <-time.After(refreshDelay):
			}
			// Requests made while waiting are covered by this scan.
			select {
			case <-ix.refresh:
			default:
			}
		}
	}
}

// Refresh asks Run for a rescan soon. It does not block.
func (ix *Index) Refresh() {
	select {
	case ix.refresh <- struct{}{}:
	default:
	}
}

// Scan walks the root and replaces the entries. Hidden (dot) files and
// folders are skipped unless shown, as are folders that cannot be read.
func (ix *Index) Scan(ctx context.Context) {
	ix.mu.Lock()
	ix.scanning = true
	ix.mu.Unlock()

	start := time.Now()
	showHidden := ix.showHidden()
	var entries []Entry
	err := fs.WalkDir(ix.fsys, ".", func(p string, d fs.DirEntry, err error) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if p == "." {
			return err
		}
		if !showHidden && strings.HasPrefix(d.Name(), ".") {
			if d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if err != nil {
			ix.logger.Debug("scan: skipping", "path", p, "error", err)
			return nil
		}
		e, ok := ix.entry(p, d)
		if ok {
			entries = append(entries, e)
		}
		return nil
	})
	took := time.Since(start)

	ix.mu.Lock()
	defer ix.mu.Unlock()
	ix.scanning = false
	if err != nil {
		if !errors.Is(err, context.Canceled) {
			ix.logger.Error("scan failed", "error", err)
		}
		return
	}
	// The first scan tells how long searches lag behind changes on disk.
	level := slog.LevelDebug
	if ix.status.ScannedAt.IsZero() {
		level = slog.LevelInfo
	}
	ix.entries = entries
	ix.status = Status{Entries: len(entries), ScannedAt: time.Now(), Took: took}
	ix.logger.Log(ctx, level, "scanned", "entries", len(entries), "took", took.Round(time.Millisecond))
}

func (ix *Index) entry(p string, d fs.DirEntry) (Entry, bool) {
	fi, err := d.Info()
	if err == nil && fi.Mode()&fs.ModeSymlink != 0 {
		// Report what the link points to, but do not descend into it:
		// WalkDir does not follow links.
		fi, err = fs.Stat(ix.fsys, p)
	}
	if err != nil {
		return Entry{}, false
	}
	name := path.Base(p)
	owner, group := fileinfo.Owner(fi)
	return Entry{
		Path:    p,
		Name:    name,
		IsDir:   fi.IsDir(),
		Size:    fi.Size(),
		ModTime: fi.ModTime(),
		Mode:    fi.Mode(),
		Owner:   owner,
		Group:   group,
		lower:   strings.ToLower(name),
	}, true
}

// Status reports on the last scan.
func (ix *Index) Status() Status {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	s := ix.status
	s.Scanning = ix.scanning
	return s
}

// Search returns up to limit entries under the folder scope ("." for the
// root) whose name contains every space-separated term of query, ignoring
// case, and the number of all matches. Exact and prefix name matches come
// first, then entries in index order.
func (ix *Index) Search(scope, query string, limit int) ([]Entry, int) {
	terms := strings.Fields(strings.ToLower(query))
	if len(terms) == 0 {
		return []Entry{}, 0
	}
	prefix := ""
	if scope != "." {
		prefix = scope + "/"
	}
	whole := strings.Join(terms, " ")

	ix.mu.RLock()
	defer ix.mu.RUnlock()
	type match struct {
		rank int
		e    *Entry
	}
	var matches []match
	for i := range ix.entries {
		e := &ix.entries[i]
		if !strings.HasPrefix(e.Path, prefix) || !containsAll(e.lower, terms) {
			continue
		}
		rank := 2
		switch {
		case e.lower == whole:
			rank = 0
		case strings.HasPrefix(e.lower, terms[0]):
			rank = 1
		}
		matches = append(matches, match{rank, e})
	}
	slices.SortStableFunc(matches, func(a, b match) int { return a.rank - b.rank })

	results := make([]Entry, 0, min(limit, len(matches)))
	for _, m := range matches[:min(limit, len(matches))] {
		results = append(results, *m.e)
	}
	return results, len(matches)
}

func containsAll(s string, terms []string) bool {
	for _, t := range terms {
		if !strings.Contains(s, t) {
			return false
		}
	}
	return true
}

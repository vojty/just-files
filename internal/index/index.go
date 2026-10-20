// Package index keeps an in-memory list of every file and folder name under
// the root, so searches filter a list instead of walking the disk. The list
// is rebuilt by a full walk at startup, periodically, and shortly after the
// server changes something (see Refresh).
//
// Only names are kept, compactly: whole filesystems can hold millions of
// files. Callers stat the few results they show.
package index

import (
	"bytes"
	"context"
	"errors"
	"io/fs"
	"log/slog"
	"slices"
	"strings"
	"sync"
	"time"
)

// node is a file or folder found by a scan. Its name and lower-case name
// are in the scan's names buffer, which holds no pointers, so the garbage
// collector need not look into either.
type node struct {
	name, lower span
	parent      int32 // index of the folder holding it, -1 at the root
	end         int32 // index after its last descendant
}

// span is a part of the names buffer.
type span struct {
	off uint32
	len uint16
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
	skip       func() []string
	logger     *slog.Logger

	refresh chan struct{}

	mu       sync.RWMutex
	nodes    []node // in walk order, so a folder's descendants follow it
	names    []byte
	status   Status
	scanning bool
}

// New returns an empty index of fsys; call Run to fill it. Hidden (dot)
// files and folders are indexed while showHidden reports true; call Refresh
// when that changes. Each scan leaves out the folders listed by skip,
// slash-separated and relative to the root.
func New(fsys fs.FS, showHidden func() bool, skip func() []string, logger *slog.Logger) *Index {
	return &Index{fsys: fsys, showHidden: showHidden, skip: skip, logger: logger, refresh: make(chan struct{}, 1)}
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
// folders are skipped unless shown, as are skipped folders and folders that
// cannot be read.
func (ix *Index) Scan(ctx context.Context) {
	ix.mu.Lock()
	ix.scanning = true
	// Room for as much as the last scan found, to not grow by copying.
	nodes := make([]node, 0, len(ix.nodes))
	names := make([]byte, 0, len(ix.names))
	ix.mu.Unlock()

	start := time.Now()
	showHidden := ix.showHidden()
	skip := map[string]bool{}
	if ix.skip != nil {
		for _, p := range ix.skip() {
			skip[p] = true
		}
	}
	add := func(s string) span {
		sp := span{uint32(len(names)), uint16(len(s))}
		names = append(names, s...)
		return sp
	}
	// The folders holding the current entry, innermost last.
	type folder struct {
		path  string
		index int32
	}
	var parents []folder
	err := fs.WalkDir(ix.fsys, ".", func(p string, d fs.DirEntry, err error) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if p == "." {
			return err
		}
		if !showHidden && strings.HasPrefix(d.Name(), ".") || d.IsDir() && skip[p] {
			if d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if err != nil {
			ix.logger.Debug("scan: skipping", "path", p, "error", err)
			return nil
		}
		for len(parents) > 0 && !strings.HasPrefix(p, parents[len(parents)-1].path+"/") {
			parents = parents[:len(parents)-1]
		}
		n := node{parent: -1, end: int32(len(nodes) + 1)}
		if len(parents) > 0 {
			n.parent = parents[len(parents)-1].index
		}
		name := d.Name()
		n.name = add(name)
		n.lower = n.name
		if lower := strings.ToLower(name); lower != name {
			n.lower = add(lower)
		}
		if d.IsDir() {
			parents = append(parents, folder{p, int32(len(nodes))})
		}
		nodes = append(nodes, n)
		return nil
	})
	// Children come after their folder, so going backwards each folder's
	// end is final before it is passed on to its parent.
	for i := len(nodes) - 1; i >= 0; i-- {
		if p := nodes[i].parent; p >= 0 {
			nodes[p].end = max(nodes[p].end, nodes[i].end)
		}
	}
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
	ix.nodes, ix.names = nodes, names
	ix.status = Status{Entries: len(nodes), ScannedAt: time.Now(), Took: took}
	ix.logger.Log(ctx, level, "scanned", "entries", len(nodes), "names_bytes", len(names), "took", took.Round(time.Millisecond))
}

func (ix *Index) bytes(s span) []byte { return ix.names[s.off : s.off+uint32(s.len)] }

// path returns the slash-separated path of node i.
func (ix *Index) path(i int32) string {
	var parts []string
	for ; i >= 0; i = ix.nodes[i].parent {
		parts = append(parts, string(ix.bytes(ix.nodes[i].name)))
	}
	slices.Reverse(parts)
	return strings.Join(parts, "/")
}

// within returns the range of nodes under the folder scope ("." for the
// root), or an empty one if the index has no such folder.
func (ix *Index) within(scope string) (lo, hi int32) {
	lo, hi = 0, int32(len(ix.nodes))
	if scope == "." {
		return lo, hi
	}
	for _, part := range strings.Split(scope, "/") {
		c := lo
		for c < hi && string(ix.bytes(ix.nodes[c].name)) != part {
			c = ix.nodes[c].end // the next sibling
		}
		if c == hi {
			return 0, 0
		}
		lo, hi = c+1, ix.nodes[c].end
	}
	return lo, hi
}

// Status reports on the last scan.
func (ix *Index) Status() Status {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	s := ix.status
	s.Scanning = ix.scanning
	return s
}

// Search returns the paths of up to limit entries under the folder scope
// ("." for the root) whose name contains every space-separated term of
// query, ignoring case, and the number of all matches. Exact and prefix
// name matches come first, then entries in index order.
func (ix *Index) Search(scope, query string, limit int) ([]string, int) {
	fields := strings.Fields(strings.ToLower(query))
	if len(fields) == 0 {
		return []string{}, 0
	}
	terms := make([][]byte, len(fields))
	for i, f := range fields {
		terms[i] = []byte(f)
	}
	whole := []byte(strings.Join(fields, " "))

	ix.mu.RLock()
	defer ix.mu.RUnlock()
	type match struct {
		rank int
		i    int32
	}
	var matches []match
	lo, hi := ix.within(scope)
	for i := lo; i < hi; i++ {
		lower := ix.bytes(ix.nodes[i].lower)
		if !containsAll(lower, terms) {
			continue
		}
		rank := 2
		switch {
		case bytes.Equal(lower, whole):
			rank = 0
		case bytes.HasPrefix(lower, terms[0]):
			rank = 1
		}
		matches = append(matches, match{rank, i})
	}
	slices.SortStableFunc(matches, func(a, b match) int { return a.rank - b.rank })

	results := make([]string, 0, min(limit, len(matches)))
	for _, m := range matches[:min(limit, len(matches))] {
		results = append(results, ix.path(m.i))
	}
	return results, len(matches)
}

func containsAll(s []byte, terms [][]byte) bool {
	for _, t := range terms {
		if !bytes.Contains(s, t) {
			return false
		}
	}
	return true
}

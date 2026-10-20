// Package fileinfo reads metadata of files that fs.FileInfo does not expose
// portably.
package fileinfo

import (
	"io/fs"
	"strconv"
	"sync"
)

// names caches user and group names by id: looking them up reads
// /etc/passwd or asks NSS, too slow to repeat for every file.
type names struct {
	mu     sync.Mutex
	byID   map[uint32]string
	lookup func(id string) (string, error)
}

func (n *names) name(id uint32) string {
	n.mu.Lock()
	defer n.mu.Unlock()
	if s, ok := n.byID[id]; ok {
		return s
	}
	s := strconv.FormatUint(uint64(id), 10)
	if name, err := n.lookup(s); err == nil {
		s = name
	}
	n.byID[id] = s
	return s
}

// Owner returns the names of the user and group owning the file, or their
// ids when they have no name, or "" where the system has no owners.
func Owner(fi fs.FileInfo) (user, group string) {
	return owner(fi)
}

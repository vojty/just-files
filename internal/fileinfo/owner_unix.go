//go:build unix

package fileinfo

import (
	"io/fs"
	"os/user"
	"syscall"
)

var (
	users = &names{byID: map[uint32]string{}, lookup: func(id string) (string, error) {
		u, err := user.LookupId(id)
		if err != nil {
			return "", err
		}
		return u.Username, nil
	}}
	groups = &names{byID: map[uint32]string{}, lookup: func(id string) (string, error) {
		g, err := user.LookupGroupId(id)
		if err != nil {
			return "", err
		}
		return g.Name, nil
	}}
)

func owner(fi fs.FileInfo) (string, string) {
	st, ok := fi.Sys().(*syscall.Stat_t)
	if !ok {
		return "", ""
	}
	return users.name(st.Uid), groups.name(st.Gid)
}

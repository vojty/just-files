package fileinfo

import (
	"os"
	"slices"
	"strconv"
	"strings"
)

// virtualFS are the types of kernel filesystems, whose files describe the
// running system instead of being stored anywhere.
var virtualFS = map[string]bool{
	"autofs": true, "binfmt_misc": true, "bpf": true, "cgroup": true,
	"cgroup2": true, "configfs": true, "debugfs": true, "devpts": true,
	"devtmpfs": true, "efivarfs": true, "fusectl": true, "hugetlbfs": true,
	"mqueue": true, "nsfs": true, "proc": true, "pstore": true,
	"rpc_pipefs": true, "securityfs": true, "sysfs": true, "tracefs": true,
}

// VirtualMounts returns the absolute paths where kernel filesystems such as
// /proc and /sys are mounted.
func VirtualMounts() ([]string, error) {
	b, err := os.ReadFile("/proc/self/mountinfo")
	if err != nil {
		return nil, err
	}
	return parseMountinfo(string(b)), nil
}

// parseMountinfo returns the virtual mount points listed in mountinfo, see
// proc_pid_mountinfo(5).
func parseMountinfo(mountinfo string) []string {
	var mounts []string
	for line := range strings.Lines(mountinfo) {
		fields := strings.Fields(line)
		sep := slices.Index(fields, "-")
		if sep < 5 || sep+1 >= len(fields) || !virtualFS[fields[sep+1]] {
			continue
		}
		mounts = append(mounts, unescape(fields[4]))
	}
	return mounts
}

// unescape decodes the octal escapes, such as \040 for a space, of a path
// in mountinfo.
func unescape(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] == '\\' && i+4 <= len(s) {
			if n, err := strconv.ParseUint(s[i+1:i+4], 8, 8); err == nil {
				b.WriteByte(byte(n))
				i += 3
				continue
			}
		}
		b.WriteByte(s[i])
	}
	return b.String()
}

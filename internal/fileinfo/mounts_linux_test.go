package fileinfo

import (
	"slices"
	"testing"
)

func TestParseMountinfo(t *testing.T) {
	const mountinfo = `28 34 0:25 / /sys rw,nosuid,nodev,noexec,relatime shared:6 - sysfs sysfs rw
29 34 0:26 / /proc rw,nosuid,nodev,noexec,relatime shared:12 - proc proc rw
32 34 0:28 / /run rw,nosuid,nodev,noexec,relatime shared:5 - tmpfs tmpfs rw,size=1562112k,mode=755
34 1 8:2 / / rw,relatime shared:1 - ext4 /dev/sda2 rw
40 34 0:30 / /data/my\040disk/proc rw master:7 - proc proc rw
`
	want := []string{"/sys", "/proc", "/data/my disk/proc"}
	if got := parseMountinfo(mountinfo); !slices.Equal(got, want) {
		t.Errorf("parseMountinfo = %q, want %q", got, want)
	}
}

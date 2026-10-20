package fileinfo

import (
	"os"
	"os/user"
	"path/filepath"
	"runtime"
	"testing"
)

func TestOwner(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("no file owners")
	}
	f := filepath.Join(t.TempDir(), "f")
	if err := os.WriteFile(f, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(f)
	if err != nil {
		t.Fatal(err)
	}
	me, err := user.Current()
	if err != nil {
		t.Skip(err)
	}
	if u, g := Owner(fi); u != me.Username || g == "" {
		t.Errorf("Owner = %q, %q; want %q and a group", u, g, me.Username)
	}
}

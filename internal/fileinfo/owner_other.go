//go:build !unix

package fileinfo

import "io/fs"

func owner(fs.FileInfo) (string, string) { return "", "" }

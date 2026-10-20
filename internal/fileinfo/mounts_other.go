//go:build !linux

package fileinfo

// VirtualMounts returns the absolute paths where kernel filesystems such as
// /proc and /sys are mounted; none are known on this system.
func VirtualMounts() ([]string, error) { return nil, nil }

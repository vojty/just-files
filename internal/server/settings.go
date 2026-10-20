package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/danielgtaylor/huma/v2"
)

// Settings are the options changed in the web UI. They apply at once and
// are saved to a JSON file.
type Settings struct {
	ShowHidden bool `json:"showHidden" doc:"List hidden files and folders (names starting with a dot), and allow opening, creating and changing them."`
}

// settingsStore holds the settings and the file they are saved to.
type settingsStore struct {
	file string

	mu       sync.RWMutex
	settings Settings
}

// loadSettings reads the settings from file; a missing file gives the
// defaults, and is created on the first save.
func loadSettings(file string) (*settingsStore, error) {
	st := &settingsStore{file: file}
	b, err := os.ReadFile(file)
	if errors.Is(err, fs.ErrNotExist) {
		return st, nil
	}
	if err != nil {
		return nil, fmt.Errorf("settings: %w", err)
	}
	if err := json.Unmarshal(b, &st.settings); err != nil {
		return nil, fmt.Errorf("settings: %s: %w", file, err)
	}
	return st, nil
}

func (st *settingsStore) get() Settings {
	st.mu.RLock()
	defer st.mu.RUnlock()
	return st.settings
}

// save writes s to a temporary file renamed over the settings file, so a
// failed write never leaves a broken file, and applies it.
func (st *settingsStore) save(s Settings) error {
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(st.file), 0o755); err != nil {
		return err
	}
	tmp := st.file + ".tmp"
	if err := os.WriteFile(tmp, append(b, '\n'), 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, st.file); err != nil {
		os.Remove(tmp)
		return err
	}
	st.settings = s
	return nil
}

// hidden reports whether name is a hidden (dot) file or folder that the
// settings keep out of reach.
func (s *Server) hidden(name string) bool {
	return strings.HasPrefix(name, ".") && !s.settings.get().ShowHidden
}

func (s *Server) registerSettings(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "getSettings",
		Method:      http.MethodGet,
		Path:        "/api/settings",
		Summary:     "Get the settings",
		Tags:        []string{"server"},
	}, func(ctx context.Context, _ *struct{}) (*response[Settings], error) {
		return &response[Settings]{s.settings.get()}, nil
	})
	huma.Register(api, huma.Operation{
		OperationID: "saveSettings",
		Method:      http.MethodPut,
		Path:        "/api/settings",
		Summary:     "Change and save the settings",
		Description: "The settings apply at once.",
		Tags:        []string{"server"},
	}, func(ctx context.Context, in *struct{ Body Settings }) (*response[Settings], error) {
		before := s.settings.get()
		if err := s.settings.save(in.Body); err != nil {
			return nil, s.fail(ctx, err)
		}
		s.Logger.Info("settings saved", "file", s.settings.file, "show_hidden", in.Body.ShowHidden)
		if in.Body.ShowHidden != before.ShowHidden {
			// The index holds hidden files only while they are shown.
			s.index.Refresh()
		}
		return &response[Settings]{in.Body}, nil
	})
}

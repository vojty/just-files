// Package server serves the web UI and its JSON API: browsing, searching and
// managing the files under the root folder. The API is described by an
// OpenAPI document (see OpenAPI) from which the UI's client is generated.
package server

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"

	"just-files/internal/index"
)

// Info describes the server and its root folder.
type Info struct {
	Root      string    `json:"root" doc:"Absolute path of the root folder."`
	Name      string    `json:"name" doc:"Base name of the root folder."`
	StartedAt time.Time `json:"startedAt"`
}

// HTTPError is an error with the HTTP status to report it with.
type HTTPError struct {
	Status int
	Err    error
}

func (e *HTTPError) Error() string { return e.Err.Error() }
func (e *HTTPError) Unwrap() error { return e.Err }

// Invalid marks err as a client input error (400).
func Invalid(err error) error { return &HTTPError{http.StatusBadRequest, err} }

// Conflict marks err as a conflict with the current state (409).
func Conflict(err error) error { return &HTTPError{http.StatusConflict, err} }

// Server is the HTTP server.
type Server struct {
	UIDir  string // built web UI; empty or missing serves only the API
	Logger *slog.Logger

	root     *os.Root
	rootPath string // absolute path of the root folder
	index    *index.Index
	settings *settingsStore
	started  time.Time
}

// New returns a server managing the files under dir, with the settings
// saved in settingsFile. Run the returned server's Index to fill the search
// index.
func New(dir, uiDir, settingsFile string, logger *slog.Logger) (*Server, error) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	settings, err := loadSettings(settingsFile)
	if err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(abs)
	if err != nil {
		return nil, err
	}
	s := &Server{
		UIDir:    uiDir,
		Logger:   logger,
		root:     root,
		rootPath: abs,
		settings: settings,
		started:  time.Now(),
	}
	s.index = index.New(root.FS(), func() bool { return settings.get().ShowHidden }, logger.With("component", "index"))
	return s, nil
}

// Close releases the root folder handle.
func (s *Server) Close() error { return s.root.Close() }

// Index returns the search index.
func (s *Server) Index() *index.Index { return s.index }

// Handler returns the HTTP handler with request logging.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	s.register(newAPI(mux))
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeProblem(w, http.StatusNotFound, "not found")
	})
	mux.HandleFunc("/", s.serveUI)
	// The UI has no login, so it must at least not be usable from other
	// web sites: browsers reject cross-origin requests that change
	// something.
	cop := http.NewCrossOriginProtection()
	cop.SetDenyHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.Logger.Warn("cross-origin request rejected", "method", r.Method, "url", r.URL.String(), "origin", r.Header.Get("Origin"))
		writeProblem(w, http.StatusForbidden, "cross-origin request rejected")
	}))
	return s.logRequests(noSniff(cop.Handler(mux)))
}

// noSniff stops browsers from guessing content types, so an uploaded HTML
// file is never run as a page of the UI.
func noSniff(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}

// OpenAPI returns the OpenAPI document of the API.
func OpenAPI() *huma.OpenAPI {
	api := newAPI(http.NewServeMux())
	(&Server{}).register(api)
	return api.OpenAPI()
}

func newAPI(mux *http.ServeMux) huma.API {
	config := huma.DefaultConfig("just-files API", "1.0.0")
	config.OpenAPIPath = "/api/openapi"
	config.DocsPath = "/api/docs"
	// No $schema links in the responses.
	config.SchemasPath = ""
	config.CreateHooks = nil
	return humago.New(mux, config)
}

// response is an operation output with a JSON body.
type response[T any] struct{ Body T }

func (s *Server) register(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "getInfo",
		Method:      http.MethodGet,
		Path:        "/api/info",
		Summary:     "Describe the server and its root folder",
		Tags:        []string{"server"},
	}, s.info)
	s.registerFiles(api)
	s.registerSearch(api)
	s.registerSettings(api)
}

func (s *Server) info(ctx context.Context, _ *struct{}) (*response[Info], error) {
	return &response[Info]{Info{Root: s.rootPath, Name: filepath.Base(s.rootPath), StartedAt: s.started}}, nil
}

// serveUI serves the built web UI, falling back to index.html for client
// side routes.
func (s *Server) serveUI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		return
	}
	if s.UIDir == "" {
		http.Error(w, "web UI is not available: the UI directory is not set", http.StatusNotFound)
		return
	}
	ui := os.DirFS(s.UIDir)
	p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if p == "" {
		p = "index.html"
	}
	if fi, err := fs.Stat(ui, p); err != nil || fi.IsDir() {
		p = "index.html"
	}
	if strings.HasPrefix(p, "assets/") {
		// Vite puts a content hash in asset file names.
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	if _, err := fs.Stat(ui, p); err != nil {
		http.Error(w, "web UI is not available: "+s.UIDir+" has no index.html (run npm run build)", http.StatusNotFound)
		return
	}
	http.ServeFileFS(w, r, ui, p)
}

// writeProblem writes an error in the format of the API's errors.
func writeProblem(w http.ResponseWriter, status int, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(&huma.ErrorModel{
		Title:  http.StatusText(status),
		Status: status,
		Detail: detail,
	})
}

// fail logs err and returns it as an API error with a matching status.
func (s *Server) fail(ctx context.Context, err error) error {
	status := http.StatusInternalServerError
	var he *HTTPError
	switch {
	case errors.As(err, &he):
		status = he.Status
	case errors.Is(err, fs.ErrPermission):
		// The server's user may not read or change the file, e.g. /root.
		status = http.StatusForbidden
	case errors.Is(err, fs.ErrNotExist):
		status = http.StatusNotFound
	case errors.Is(err, fs.ErrExist):
		status = http.StatusConflict
	case errors.Is(err, fs.ErrInvalid):
		status = http.StatusBadRequest
	}
	level := slog.LevelWarn
	if status >= 500 {
		level = slog.LevelError
	}
	attrs := []any{"status", status, "error", err}
	if r, ok := ctx.Value(requestKey{}).(*http.Request); ok {
		attrs = append([]any{"method", r.Method, "url", r.URL.String()}, attrs...)
	}
	s.Logger.Log(ctx, level, "request failed", attrs...)
	return huma.NewError(status, err.Error())
}

// requestKey is the context key of the request, for logging.
type requestKey struct{}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r.WithContext(context.WithValue(r.Context(), requestKey{}, r)))
		s.Logger.Debug("http",
			"method", r.Method,
			"url", r.URL.String(),
			"status", sw.status,
			"took", time.Since(start),
			"remote", r.RemoteAddr,
		)
	})
}

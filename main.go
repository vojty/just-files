// Command just-files is a small web file browser for one folder, with search
// over an in-memory index and drag and drop uploads.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/lmittmann/tint"

	"just-files/internal/server"
)

type config struct {
	rootPath     string
	configFile   string
	port         int
	uiDir        string
	scanInterval time.Duration
	logLevel     string
	logFormat    string
}

// env returns the environment variable key, or def when unset.
func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v, ok := os.LookupEnv(key); ok {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func envDuration(key string, def time.Duration) time.Duration {
	if v, ok := os.LookupEnv(key); ok {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}

// parseConfig reads settings with this precedence: command line flags,
// environment variables, built-in defaults.
func parseConfig() config {
	var c config
	flag.StringVar(&c.rootPath, "path", env("ROOT_PATH", "."), "folder to serve [ROOT_PATH]")
	defaultConfig := "just-files-settings.json"
	if d, err := os.UserConfigDir(); err == nil {
		defaultConfig = filepath.Join(d, "just-files", "settings.json")
	}
	flag.StringVar(&c.configFile, "config", env("CONFIG_FILE", defaultConfig), "settings file, written when settings are changed in the web UI [CONFIG_FILE]")
	flag.IntVar(&c.port, "port", envInt("PORT", 8080), "web UI port [PORT]")
	flag.StringVar(&c.uiDir, "ui-dir", env("UI_DIR", "ui/dist"), "folder with the built web UI [UI_DIR]")
	flag.DurationVar(&c.scanInterval, "scan-interval", envDuration("SCAN_INTERVAL", 10*time.Minute), "how often to rescan the folder for search, 0 disables; changes made in the UI trigger a rescan anyway [SCAN_INTERVAL]")
	flag.StringVar(&c.logLevel, "log-level", env("LOG_LEVEL", "info"), "debug, info, warn or error [LOG_LEVEL]")
	flag.StringVar(&c.logFormat, "log-format", env("LOG_FORMAT", "auto"), "auto, pretty, text or json; auto is pretty on a terminal, text otherwise [LOG_FORMAT]")
	flag.Parse()
	return c
}

// isTerminal reports whether f is attached to a terminal.
func isTerminal(f *os.File) bool {
	fi, err := f.Stat()
	return err == nil && fi.Mode()&os.ModeCharDevice != 0
}

func newLogger(c config) (*slog.Logger, error) {
	var level slog.Level
	if err := level.UnmarshalText([]byte(c.logLevel)); err != nil {
		return nil, fmt.Errorf("invalid log level %q", c.logLevel)
	}
	format := strings.ToLower(c.logFormat)
	if format == "auto" {
		format = "text"
		if isTerminal(os.Stderr) {
			format = "pretty"
		}
	}
	switch format {
	case "pretty":
		// Human-readable output: short local time, colored levels unless
		// stderr is not a terminal or NO_COLOR is set (https://no-color.org).
		_, noColor := os.LookupEnv("NO_COLOR")
		return slog.New(tint.NewHandler(os.Stderr, &tint.Options{
			Level:      level,
			TimeFormat: "15:04:05.000",
			NoColor:    noColor || !isTerminal(os.Stderr),
		})), nil
	case "text":
		return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level})), nil
	case "json":
		return slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: level})), nil
	default:
		return nil, fmt.Errorf("invalid log format %q", c.logFormat)
	}
}

func main() {
	c := parseConfig()
	logger, err := newLogger(c)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	slog.SetDefault(logger)
	if err := run(c, logger); err != nil {
		logger.Error("fatal", "error", err)
		os.Exit(1)
	}
}

func run(c config, logger *slog.Logger) error {
	srv, err := server.New(c.rootPath, c.uiDir, c.configFile, logger.With("component", "server"))
	if err != nil {
		return err
	}
	defer srv.Close()

	ln, err := net.Listen("tcp", ":"+strconv.Itoa(c.port))
	if err != nil {
		return fmt.Errorf("listener: %w", err)
	}
	// No write timeout: uploads and downloads of large files take long.
	httpSrv := &http.Server{
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 30 * time.Second,
		ErrorLog:          slog.NewLogLogger(logger.With("component", "http").Handler(), slog.LevelWarn),
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go srv.Index().Run(ctx, c.scanInterval)

	logger.Info("starting", "path", c.rootPath, "port", c.port, "config", c.configFile, "scan_interval", c.scanInterval)

	errc := make(chan error, 1)
	go func() {
		if err := httpSrv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errc <- fmt.Errorf("http server: %w", err)
		}
	}()

	select {
	case <-ctx.Done():
		logger.Info("shutting down")
	case err = <-errc:
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if serr := httpSrv.Shutdown(shutdownCtx); serr != nil {
		logger.Warn("http server shutdown", "error", serr)
	}
	return err
}

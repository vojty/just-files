package server

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func newTestServer(t *testing.T) (*httptest.Server, string, *Server) {
	t.Helper()
	media := t.TempDir()
	ui := t.TempDir()
	if err := os.WriteFile(filepath.Join(ui, "index.html"), []byte("<html>app</html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	s, err := New(media, ui, filepath.Join(t.TempDir(), "settings.json"), slog.New(slog.DiscardHandler))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	return ts, media, s
}

func do(t *testing.T, method, url, body string) (int, string) {
	t.Helper()
	req, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b)
}

func upload(t *testing.T, url, name, content string) int {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile("file", name)
	fw.Write([]byte(content))
	mw.Close()
	resp, err := http.Post(url, mw.FormDataContentType(), &buf)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	return resp.StatusCode
}

func TestFiles(t *testing.T) {
	ts, media, _ := newTestServer(t)
	api := ts.URL + "/api/files"

	if code, body := do(t, "POST", api+"/mkdir", `{"path":"Movies"}`); code != 201 {
		t.Fatalf("mkdir: %d %s", code, body)
	}
	if code, _ := do(t, "POST", api+"/mkdir", `{"path":"Movies"}`); code != 409 {
		t.Errorf("mkdir existing: %d, want 409", code)
	}
	if code := upload(t, api+"/upload?path=Movies", "a.mkv", "video"); code != 201 {
		t.Fatalf("upload: %d", code)
	}
	if code := upload(t, api+"/upload?path=Movies", "a.mkv", "other"); code != 409 {
		t.Errorf("upload conflict: %d, want 409", code)
	}
	if code := upload(t, api+"/upload?path=Movies&overwrite=1", "a.mkv", "video2"); code != 201 {
		t.Errorf("upload overwrite: %d", code)
	}
	if b, _ := os.ReadFile(filepath.Join(media, "Movies", "a.mkv")); string(b) != "video2" {
		t.Errorf("uploaded content %q", b)
	}
	if code := upload(t, api+"/upload?path=Movies", ".hidden", "x"); code != 400 {
		t.Errorf("upload hidden name: %d, want 400", code)
	}

	code, body := do(t, "GET", api+"?path=Movies", "")
	var list struct{ Entries []FileEntry }
	json.Unmarshal([]byte(body), &list)
	if code != 200 || len(list.Entries) != 1 || list.Entries[0].Kind != "video" || list.Entries[0].Path != "Movies/a.mkv" {
		t.Errorf("list: %d %s", code, body)
	}

	if code, body := do(t, "GET", api+"/download?path=Movies/a.mkv", ""); code != 200 || body != "video2" {
		t.Errorf("download: %d %q", code, body)
	}

	if code, body := do(t, "POST", api+"/move", `{"from":"Movies/a.mkv","to":"b.mkv"}`); code != 200 {
		t.Errorf("move: %d %s", code, body)
	}
	if code, _ := do(t, "POST", api+"/move", `{"from":"Movies","to":"Movies/x"}`); code != 400 {
		t.Errorf("move into itself: %d, want 400", code)
	}

	if code, _ := do(t, "DELETE", api+"?path=Movies", ""); code != 204 {
		t.Errorf("delete: %d", code)
	}
	if _, err := os.Stat(filepath.Join(media, "Movies")); !os.IsNotExist(err) {
		t.Errorf("Movies still exists: %v", err)
	}
	if code, _ := do(t, "DELETE", api+"?path=", ""); code != 400 {
		t.Errorf("delete root: %d, want 400", code)
	}
	if code, body := do(t, "DELETE", api+"?path=missing", ""); code != 404 || !strings.Contains(body, `"detail":"`) {
		t.Errorf("delete missing: %d %s, want 404 with a problem detail", code, body)
	}
}

func TestTraversal(t *testing.T) {
	ts, media, _ := newTestServer(t)
	outside := filepath.Join(filepath.Dir(media), "outside.txt")
	os.WriteFile(outside, []byte("secret"), 0o644)
	os.Symlink(filepath.Dir(media), filepath.Join(media, "link"))

	for _, p := range []string{"../outside.txt", "link/outside.txt"} {
		if code, body := do(t, "GET", ts.URL+"/api/files/download?path="+p, ""); code == 200 {
			t.Errorf("download %s: got %q", p, body)
		}
	}
	do(t, "POST", ts.URL+"/api/files/move", `{"from":"../outside.txt","to":"stolen.txt"}`)
	if _, err := os.Stat(outside); err != nil {
		t.Errorf("file outside the media folder was moved: %v", err)
	}

	os.WriteFile(filepath.Join(media, ".secret"), []byte("secret"), 0o644)
	if code, body := do(t, "GET", ts.URL+"/api/files/download?path=.secret", ""); code != 400 {
		t.Errorf("download hidden file: %d %q, want 400", code, body)
	}
}

func TestCrossOrigin(t *testing.T) {
	ts, media, _ := newTestServer(t)
	send := func(method, url string, header map[string]string) int {
		t.Helper()
		req, _ := http.NewRequest(method, url, strings.NewReader(`{"path":"x"}`))
		req.Header.Set("Content-Type", "application/json")
		for k, v := range header {
			req.Header.Set(k, v)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}

	if resp, err := http.Get(ts.URL + "/api/files"); err == nil {
		if v := resp.Header.Get("X-Content-Type-Options"); v != "nosniff" {
			t.Errorf("X-Content-Type-Options = %q", v)
		}
		resp.Body.Close()
	}

	// Cross-site requests changing something are rejected, same-site ones not.
	if code := send("POST", ts.URL+"/api/files/mkdir", map[string]string{"Sec-Fetch-Site": "cross-site"}); code != 403 {
		t.Errorf("cross-site mkdir: %d, want 403", code)
	}
	if code := send("DELETE", ts.URL+"/api/files?path=x", map[string]string{"Origin": "http://evil.example"}); code != 403 {
		t.Errorf("cross-origin delete: %d, want 403", code)
	}
	if code := send("POST", ts.URL+"/api/files/mkdir", map[string]string{"Origin": ts.URL, "Sec-Fetch-Site": "same-origin"}); code != 201 {
		t.Errorf("same-origin mkdir: %d, want 201", code)
	}
	if _, err := os.Stat(filepath.Join(media, "x")); err != nil {
		t.Error(err)
	}
}

func TestUI(t *testing.T) {
	ts, _, _ := newTestServer(t)
	for _, p := range []string{"/", "/?path=a/b"} {
		if code, body := do(t, "GET", ts.URL+p, ""); code != 200 || !strings.Contains(body, "app") {
			t.Errorf("GET %s: %d %q", p, code, body)
		}
	}
	if code, _ := do(t, "GET", ts.URL+"/api/nope", ""); code != 404 {
		t.Errorf("unknown api: %d, want 404", code)
	}
	if code, body := do(t, "GET", ts.URL+"/api/openapi.json", ""); code != 200 || !strings.Contains(body, `"operationId":"listFiles"`) {
		t.Errorf("openapi: %d", code)
	}
}

func TestUploadFolder(t *testing.T) {
	ts, media, _ := newTestServer(t)
	api := ts.URL + "/api/files/upload"
	if code := upload(t, api+"?path=Album/Disc%201", "a.mp3", "x"); code != 404 {
		t.Errorf("upload into a missing folder: %d, want 404", code)
	}
	if code := upload(t, api+"?path=Album/Disc%201&parents=true", "a.mp3", "x"); code != 201 {
		t.Fatalf("upload with parents: %d", code)
	}
	if _, err := os.Stat(filepath.Join(media, "Album", "Disc 1", "a.mp3")); err != nil {
		t.Error(err)
	}
	if code := upload(t, api+"?path=Album/.git&parents=true", "a.mp3", "x"); code != 400 {
		t.Errorf("upload into a hidden folder: %d, want 400", code)
	}
}

func TestSearch(t *testing.T) {
	ts, media, s := newTestServer(t)
	os.MkdirAll(filepath.Join(media, "Photos", "2024"), 0o755)
	os.WriteFile(filepath.Join(media, "Photos", "2024", "Beach.jpg"), []byte("x"), 0o644)
	os.WriteFile(filepath.Join(media, "beach notes.md"), []byte("x"), 0o644)
	s.Index().Scan(t.Context())

	var res SearchResults
	code, body := do(t, "GET", ts.URL+"/api/search?q=beach", "")
	json.Unmarshal([]byte(body), &res)
	if code != 200 || res.Total != 2 || res.Indexed != 4 || res.Entries[0].Kind != "image" {
		t.Errorf("search: %d %s", code, body)
	}
	code, body = do(t, "GET", ts.URL+"/api/search?q=beach&path=Photos", "")
	json.Unmarshal([]byte(body), &res)
	if code != 200 || res.Total != 1 || res.Entries[0].Path != "Photos/2024/Beach.jpg" {
		t.Errorf("scoped search: %d %s", code, body)
	}
	if code, _ := do(t, "GET", ts.URL+"/api/search?q=x&path=.git", ""); code != 400 {
		t.Errorf("search in a hidden folder: %d, want 400", code)
	}
}

func TestContent(t *testing.T) {
	ts, media, _ := newTestServer(t)
	files := map[string]string{
		"page.html":  "<script>alert(1)</script>",
		"pic.svg":    "<svg/>",
		"doc.pdf":    "%PDF-1.4",
		"notes.md":   "0123456789",
		"Makefile":   "all:",
		"photo.jpeg": "jpg",
	}
	for name, body := range files {
		os.WriteFile(filepath.Join(media, name), []byte(body), 0o644)
	}
	get := func(name, rng string) *http.Response {
		t.Helper()
		req, _ := http.NewRequest("GET", ts.URL+"/api/files/content?path="+name, nil)
		if rng != "" {
			req.Header.Set("Range", rng)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { resp.Body.Close() })
		return resp
	}

	for _, tt := range []struct{ name, ctype, csp string }{
		{"page.html", "text/plain; charset=utf-8", "sandbox"}, // never rendered as a page
		{"pic.svg", "image/svg+xml", "sandbox"},
		{"doc.pdf", "application/pdf", ""},
		{"notes.md", "text/plain; charset=utf-8", "sandbox"},
		{"Makefile", "text/plain; charset=utf-8", "sandbox"},
		{"photo.jpeg", "image/jpeg", "sandbox"},
	} {
		resp := get(tt.name, "")
		h := resp.Header
		if resp.StatusCode != 200 || h.Get("Content-Type") != tt.ctype || h.Get("Content-Security-Policy") != tt.csp ||
			!strings.HasPrefix(h.Get("Content-Disposition"), "inline") {
			t.Errorf("%s: %d, Content-Type %q, CSP %q, Content-Disposition %q", tt.name, resp.StatusCode,
				h.Get("Content-Type"), h.Get("Content-Security-Policy"), h.Get("Content-Disposition"))
		}
	}

	resp := get("notes.md", "bytes=0-3")
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 206 || string(b) != "0123" || resp.Header.Get("Content-Range") != "bytes 0-3/10" {
		t.Errorf("range: %d %q %q", resp.StatusCode, b, resp.Header.Get("Content-Range"))
	}
	if resp := get(".hidden", ""); resp.StatusCode != 400 {
		t.Errorf("hidden: %d, want 400", resp.StatusCode)
	}
	if resp := get("", ""); resp.StatusCode != 400 {
		t.Errorf("folder: %d, want 400", resp.StatusCode)
	}
}

func TestKind(t *testing.T) {
	for name, want := range map[string]string{
		"app.ts":    "text", // TypeScript, not an MPEG transport stream
		"clip.m2ts": "video",
		"a.JPG":     "image",
		"song.flac": "audio",
		"x.tar.gz":  "archive",
		"Makefile":  "other",
	} {
		if got := kind(name, false); got != want {
			t.Errorf("kind(%q) = %q, want %q", name, got, want)
		}
	}
}

func TestPermissionDenied(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root may read everything")
	}
	ts, media, _ := newTestServer(t)
	locked := filepath.Join(media, "locked")
	os.Mkdir(locked, 0o755)
	os.WriteFile(filepath.Join(locked, "secret.txt"), []byte("x"), 0o644)
	os.WriteFile(filepath.Join(media, "unreadable.txt"), []byte("x"), 0o000)
	os.Chmod(locked, 0o000)
	t.Cleanup(func() { os.Chmod(locked, 0o755) })

	for _, tt := range []struct{ method, url string }{
		{"GET", "/api/files?path=locked"},
		{"GET", "/api/files/content?path=unreadable.txt"},
		{"HEAD", "/api/files/download?path=unreadable.txt"},
		{"DELETE", "/api/files?path=locked/secret.txt"},
	} {
		if code, body := do(t, tt.method, ts.URL+tt.url, ""); code != 403 {
			t.Errorf("%s %s: %d %s, want 403", tt.method, tt.url, code, body)
		}
	}
	if code := upload(t, ts.URL+"/api/files/upload?path=locked", "a.txt", "x"); code != 403 {
		t.Errorf("upload into locked: %d, want 403", code)
	}
}

func TestShowHidden(t *testing.T) {
	media, ui := t.TempDir(), t.TempDir()
	settingsFile := filepath.Join(t.TempDir(), "conf", "settings.json")
	os.WriteFile(filepath.Join(media, ".env"), []byte("SECRET=1"), 0o644)
	os.Mkdir(filepath.Join(media, ".config"), 0o755)
	start := func() (*httptest.Server, *Server) {
		t.Helper()
		s, err := New(media, ui, settingsFile, slog.New(slog.DiscardHandler))
		if err != nil {
			t.Fatal(err)
		}
		ts := httptest.NewServer(s.Handler())
		t.Cleanup(func() { ts.Close(); s.Close() })
		return ts, s
	}
	names := func(ts *httptest.Server) string {
		t.Helper()
		_, body := do(t, "GET", ts.URL+"/api/files", "")
		var l Listing
		json.Unmarshal([]byte(body), &l)
		var n []string
		for _, e := range l.Entries {
			n = append(n, e.Name)
		}
		return strings.Join(n, ",")
	}

	ts, _ := start()
	if got := names(ts); got != "" {
		t.Errorf("hidden by default, listed %q", got)
	}
	if code, _ := do(t, "GET", ts.URL+"/api/files/content?path=.env", ""); code != 400 {
		t.Errorf("hidden content: %d, want 400", code)
	}

	if code, body := do(t, "PUT", ts.URL+"/api/settings", `{"showHidden":true}`); code != 200 || !strings.Contains(body, `"showHidden":true`) {
		t.Fatalf("save settings: %d %s", code, body)
	}
	if got := names(ts); got != ".config,.env" {
		t.Errorf("shown: listed %q", got)
	}
	if code, body := do(t, "GET", ts.URL+"/api/files/content?path=.env", ""); code != 200 || body != "SECRET=1" {
		t.Errorf("shown content: %d %q", code, body)
	}
	if code := upload(t, ts.URL+"/api/files/upload?path=.config", ".gitignore", "x"); code != 201 {
		t.Errorf("upload a dot file into a dot folder: %d", code)
	}

	// Saved: a new server starts with them shown.
	ts2, _ := start()
	if code, body := do(t, "GET", ts2.URL+"/api/settings", ""); !strings.Contains(body, `"showHidden":true`) {
		t.Errorf("settings after restart: %d %s", code, body)
	}
}

package server

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"

	"just-files/internal/fileinfo"
)

// FileEntry is a file or folder under the root folder.
type FileEntry struct {
	Name    string    `json:"name"`
	Path    string    `json:"path" doc:"Slash-separated path relative to the root folder."`
	IsDir   bool      `json:"isDir"`
	Size    int64     `json:"size"`
	ModTime time.Time `json:"modTime"`
	Kind    string    `json:"kind" enum:"folder,image,video,audio,text,archive,other"`
	Mode    string    `json:"mode" doc:"Type and permissions, as ls -l shows them, e.g. -rw-r--r--."`
	Owner   string    `json:"owner" doc:"User owning the file; empty where the system has no owners."`
	Group   string    `json:"group" doc:"Group owning the file; empty where the system has no owners."`
}

// Listing is the content of a folder.
type Listing struct {
	Path    string      `json:"path" doc:"Path of the folder, \".\" for the root folder itself."`
	Entries []FileEntry `json:"entries" nullable:"false"`
}

// Uploaded lists the files stored by an upload.
type Uploaded struct {
	Files []FileEntry `json:"files" nullable:"false"`
}

// MkdirRequest creates a folder.
type MkdirRequest struct {
	Path string `json:"path" doc:"Path of the new folder."`
}

// MoveRequest renames or moves a file or folder.
type MoveRequest struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// pathParam is a path under the root folder given as a query parameter.
type pathParam struct {
	Path string `query:"path" doc:"Slash-separated path relative to the root folder; empty for the root folder itself."`
}

func (s *Server) registerFiles(api huma.API) {
	notFound := []int{http.StatusBadRequest, http.StatusNotFound}
	huma.Register(api, huma.Operation{
		OperationID: "listFiles",
		Method:      http.MethodGet,
		Path:        "/api/files",
		Summary:     "List a folder",
		Tags:        []string{"files"},
		Errors:      notFound,
	}, s.listFiles)
	huma.Register(api, huma.Operation{
		OperationID:   "deleteFile",
		Method:        http.MethodDelete,
		Path:          "/api/files",
		Summary:       "Delete a file or folder with its content",
		Tags:          []string{"files"},
		DefaultStatus: http.StatusNoContent,
		Errors:        notFound,
	}, s.deleteFile)
	huma.Register(api, huma.Operation{
		OperationID:   "uploadFiles",
		Method:        http.MethodPost,
		Path:          "/api/files/upload",
		Summary:       "Upload files into a folder",
		Tags:          []string{"files"},
		DefaultStatus: http.StatusCreated,
		Errors:        []int{http.StatusBadRequest, http.StatusNotFound, http.StatusConflict},
	}, s.upload)
	// Huma would read the whole body for a declared request body, so it is
	// declared after registration and upload streams the parts itself.
	api.OpenAPI().Paths["/api/files/upload"].Post.RequestBody = &huma.RequestBody{
		Required: true,
		Content: map[string]*huma.MediaType{
			"multipart/form-data": {Schema: &huma.Schema{
				Type:     huma.TypeObject,
				Required: []string{"file"},
				Properties: map[string]*huma.Schema{
					"file": {
						Type:  huma.TypeArray,
						Items: &huma.Schema{Type: huma.TypeString, Format: "binary"},
					},
				},
			}},
		},
	}
	huma.Register(api, huma.Operation{
		OperationID:   "createFolder",
		Method:        http.MethodPost,
		Path:          "/api/files/mkdir",
		Summary:       "Create a folder",
		Tags:          []string{"files"},
		DefaultStatus: http.StatusCreated,
		Errors:        []int{http.StatusBadRequest, http.StatusNotFound, http.StatusConflict},
	}, s.mkdir)
	huma.Register(api, huma.Operation{
		OperationID: "moveFile",
		Method:      http.MethodPost,
		Path:        "/api/files/move",
		Summary:     "Rename or move a file or folder",
		Tags:        []string{"files"},
		Errors:      []int{http.StatusBadRequest, http.StatusNotFound, http.StatusConflict},
	}, s.move)
	huma.Register(api, huma.Operation{
		OperationID: "downloadFile",
		Method:      http.MethodGet,
		Path:        "/api/files/download",
		Summary:     "Download a file",
		Description: "Supports range requests.",
		Tags:        []string{"files"},
		Errors:      notFound,
		Responses: map[string]*huma.Response{
			"200": {
				Description: "The file content.",
				Content: map[string]*huma.MediaType{
					"application/octet-stream": {Schema: &huma.Schema{Type: huma.TypeString, Format: "binary"}},
				},
			},
		},
	}, s.download)
	huma.Register(api, huma.Operation{
		OperationID: "getFileContent",
		Method:      http.MethodGet,
		Path:        "/api/files/content",
		Summary:     "Get a file's content to view it in the browser",
		Description: "Supports range requests. Text files are sent as plain text, and nothing sent runs scripts: the browser treats it as sandboxed, except PDFs, which browsers do not show sandboxed.",
		Tags:        []string{"files"},
		Errors:      notFound,
		Responses: map[string]*huma.Response{
			"200": {
				Description: "The file content.",
				Content: map[string]*huma.MediaType{
					"application/octet-stream": {Schema: &huma.Schema{Type: huma.TypeString, Format: "binary"}},
				},
			},
		},
	}, s.content)
}

// kinds maps lower-case file extensions to the kind of file, for icons.
var kinds = map[string]string{}

func init() {
	for k, exts := range map[string]string{
		"image":   "jpg jpeg png gif webp avif heic bmp svg ico tif tiff raw",
		"video":   "mp4 mkv avi mov wmv webm m4v mpg mpeg m2ts mts flv 3gp",
		"audio":   "mp3 flac wav ogg opus m4a aac wma aiff",
		"text":    "txt md csv tsv log json yaml yml toml xml ini conf html css js ts tsx jsx go py rs c h cpp java sh srt ass vtt",
		"archive": "zip tar gz tgz bz2 xz zst 7z rar iso",
	} {
		for ext := range strings.FieldsSeq(exts) {
			if _, dup := kinds["."+ext]; dup {
				// Map order is random, so the kind would be too.
				panic("file kinds: ." + ext + " is listed twice")
			}
			kinds["."+ext] = k
		}
	}
}

func kind(name string, isDir bool) string {
	if isDir {
		return "folder"
	}
	if k, ok := kinds[strings.ToLower(path.Ext(name))]; ok {
		return k
	}
	return "other"
}

// cleanPath normalises a client-supplied relative path and rejects anything
// that would escape the root or reach a hidden (dot) file or folder, which
// are never listed. os.Root additionally rejects escapes via symlinks.
func cleanPath(p string) (string, error) {
	p = path.Clean("/" + strings.TrimPrefix(p, "./"))
	p = strings.TrimPrefix(p, "/")
	if p == "" {
		return ".", nil
	}
	if !fs.ValidPath(p) {
		return "", Invalid(fmt.Errorf("invalid path %q", p))
	}
	for part := range strings.SplitSeq(p, "/") {
		if strings.HasPrefix(part, ".") {
			return "", Invalid(fmt.Errorf("invalid path %q: hidden files are not accessible", p))
		}
	}
	return p, nil
}

// validName checks a single file or folder name chosen by the client.
func validName(name string) error {
	switch {
	case name == "", name == ".", name == "..":
		return Invalid(fmt.Errorf("invalid name %q", name))
	case strings.ContainsAny(name, `/\`):
		return Invalid(fmt.Errorf("name %q must not contain slashes", name))
	case strings.HasPrefix(name, "."):
		return Invalid(fmt.Errorf("name %q must not start with a dot", name))
	}
	return nil
}

func newEntry(rel string, fi fs.FileInfo) FileEntry {
	owner, group := fileinfo.Owner(fi)
	return FileEntry{
		Name:    fi.Name(),
		Path:    rel,
		IsDir:   fi.IsDir(),
		Size:    fi.Size(),
		ModTime: fi.ModTime(),
		Kind:    kind(fi.Name(), fi.IsDir()),
		Mode:    fi.Mode().String(),
		Owner:   owner,
		Group:   group,
	}
}

func (s *Server) listFiles(ctx context.Context, in *pathParam) (*response[Listing], error) {
	dir, err := cleanPath(in.Path)
	if err != nil {
		return nil, s.fail(ctx, err)
	}
	des, err := fs.ReadDir(s.root.FS(), dir)
	if err != nil {
		return nil, s.fail(ctx, err)
	}
	entries := []FileEntry{}
	for _, de := range des {
		if strings.HasPrefix(de.Name(), ".") {
			continue
		}
		rel := path.Join(dir, de.Name())
		fi, err := s.root.Stat(rel) // follows symlinks inside the root
		if err != nil {
			continue
		}
		entries = append(entries, newEntry(rel, fi))
	}
	sort.Slice(entries, func(i, j int) bool {
		a, b := entries[i], entries[j]
		if a.IsDir != b.IsDir {
			return a.IsDir
		}
		return strings.ToLower(a.Name) < strings.ToLower(b.Name)
	})
	return &response[Listing]{Listing{Path: dir, Entries: entries}}, nil
}

func (s *Server) requireDir(dir string) error {
	fi, err := s.root.Stat(dir)
	if err != nil {
		return err
	}
	if !fi.IsDir() {
		return Invalid(fmt.Errorf("%q is not a folder", dir))
	}
	return nil
}

func (s *Server) exists(rel string) bool {
	_, err := s.root.Lstat(rel)
	return err == nil
}

type uploadInput struct {
	Path      string `query:"path" doc:"Folder to upload into; empty for the root folder itself."`
	Overwrite bool   `query:"overwrite" doc:"Replace existing files."`
	Parents   bool   `query:"parents" doc:"Create the folder and its parents if missing, for uploads of whole folders."`

	req *http.Request
}

// Resolve keeps the request so upload can stream its multipart body.
func (in *uploadInput) Resolve(ctx huma.Context) []error {
	in.req, _ = humago.Unwrap(ctx)
	return nil
}

// upload stores the files of a multipart request in the folder given by the
// path query parameter. Each file is written to a hidden temporary file first
// and renamed when complete, so clients never see partial uploads.
func (s *Server) upload(ctx context.Context, in *uploadInput) (*response[Uploaded], error) {
	dir, err := cleanPath(in.Path)
	if err != nil {
		return nil, s.fail(ctx, err)
	}
	if in.Parents && dir != "." {
		if err := s.root.MkdirAll(dir, 0o755); err != nil {
			return nil, s.fail(ctx, err)
		}
	}
	if err := s.requireDir(dir); err != nil {
		return nil, s.fail(ctx, err)
	}
	mr, err := in.req.MultipartReader()
	if err != nil {
		return nil, s.fail(ctx, Invalid(err))
	}
	uploaded := []FileEntry{}
	defer func() {
		if len(uploaded) > 0 {
			s.index.Refresh()
		}
	}()
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, s.fail(ctx, Invalid(err))
		}
		if part.FileName() == "" {
			part.Close()
			continue
		}
		e, err := s.saveUpload(dir, part.FileName(), part, in.Overwrite)
		part.Close()
		if err != nil {
			return nil, s.fail(ctx, err)
		}
		s.Logger.Info("uploaded", "path", e.Path, "size", e.Size)
		uploaded = append(uploaded, e)
	}
	return &response[Uploaded]{Uploaded{Files: uploaded}}, nil
}

func (s *Server) saveUpload(dir, name string, src io.Reader, overwrite bool) (FileEntry, error) {
	// Browsers send only the base name, but be strict about anything else.
	if err := validName(name); err != nil {
		return FileEntry{}, err
	}
	rel := path.Join(dir, name)
	if !overwrite && s.exists(rel) {
		return FileEntry{}, Conflict(fmt.Errorf("%q already exists", rel))
	}
	tmp := path.Join(dir, "."+name+".part")
	f, err := s.root.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return FileEntry{}, err
	}
	_, err = io.Copy(f, src)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = s.root.Rename(tmp, rel)
	}
	if err != nil {
		_ = s.root.Remove(tmp)
		return FileEntry{}, err
	}
	fi, err := s.root.Stat(rel)
	if err != nil {
		return FileEntry{}, err
	}
	return newEntry(rel, fi), nil
}

func (s *Server) mkdir(ctx context.Context, in *struct{ Body MkdirRequest }) (*response[FileEntry], error) {
	rel, err := cleanPath(in.Body.Path)
	if err == nil && rel == "." {
		err = Invalid(errors.New("missing folder name"))
	}
	if err == nil {
		err = validName(path.Base(rel))
	}
	if err == nil {
		err = s.root.Mkdir(rel, 0o755)
	}
	if err != nil {
		return nil, s.fail(ctx, err)
	}
	fi, err := s.root.Stat(rel)
	if err != nil {
		return nil, s.fail(ctx, err)
	}
	s.Logger.Info("folder created", "path", rel)
	s.index.Refresh()
	return &response[FileEntry]{newEntry(rel, fi)}, nil
}

// move renames or moves a file or folder.
func (s *Server) move(ctx context.Context, in *struct{ Body MoveRequest }) (*response[FileEntry], error) {
	from, err := cleanPath(in.Body.From)
	if err != nil {
		return nil, s.fail(ctx, err)
	}
	to, err := cleanPath(in.Body.To)
	if err != nil {
		return nil, s.fail(ctx, err)
	}
	switch {
	case from == "." || to == ".":
		err = Invalid(errors.New("the root folder itself cannot be moved"))
	case to == from:
		err = Invalid(errors.New("source and target are the same"))
	case strings.HasPrefix(to, from+"/"):
		err = Invalid(errors.New("a folder cannot be moved into itself"))
	case s.exists(to):
		err = Conflict(fmt.Errorf("%q already exists", to))
	}
	if err == nil {
		err = validName(path.Base(to))
	}
	if err == nil {
		err = s.requireDir(path.Dir(to))
	}
	if err == nil {
		err = s.root.Rename(from, to)
	}
	if err != nil {
		return nil, s.fail(ctx, err)
	}
	fi, err := s.root.Stat(to)
	if err != nil {
		return nil, s.fail(ctx, err)
	}
	s.Logger.Info("moved", "from", from, "to", to)
	s.index.Refresh()
	return &response[FileEntry]{newEntry(to, fi)}, nil
}

func (s *Server) deleteFile(ctx context.Context, in *pathParam) (*struct{}, error) {
	rel, err := cleanPath(in.Path)
	if err == nil && rel == "." {
		err = Invalid(errors.New("the root folder itself cannot be deleted"))
	}
	if err == nil {
		_, err = s.root.Lstat(rel)
	}
	if err == nil {
		err = s.root.RemoveAll(rel)
	}
	if err != nil {
		return nil, s.fail(ctx, err)
	}
	s.Logger.Info("deleted", "path", rel)
	s.index.Refresh()
	return nil, nil
}

// openFile opens the file at the client-supplied path p, which must not be
// a folder.
func (s *Server) openFile(p string) (*os.File, fs.FileInfo, error) {
	rel, err := cleanPath(p)
	if err != nil {
		return nil, nil, err
	}
	f, err := s.root.Open(rel)
	if err != nil {
		return nil, nil, err
	}
	fi, err := f.Stat()
	if err == nil && fi.IsDir() {
		err = Invalid(fmt.Errorf("%q is a folder", rel))
	}
	if err != nil {
		f.Close()
		return nil, nil, err
	}
	return f, fi, nil
}

// serveFile streams f, with range requests, after setHeaders.
func serveFile(f *os.File, fi fs.FileInfo, setHeaders func(http.Header)) *huma.StreamResponse {
	return &huma.StreamResponse{Body: func(hctx huma.Context) {
		defer f.Close()
		r, w := humago.Unwrap(hctx)
		setHeaders(w.Header())
		http.ServeContent(w, r, fi.Name(), fi.ModTime(), f)
	}}
}

func (s *Server) download(ctx context.Context, in *pathParam) (*huma.StreamResponse, error) {
	f, fi, err := s.openFile(in.Path)
	if err != nil {
		return nil, s.fail(ctx, err)
	}
	return serveFile(f, fi, func(h http.Header) {
		h.Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": fi.Name()}))
	}), nil
}

// content serves a file to be shown in the page. Files are uploaded by
// anyone, so none may run as part of the UI: an HTML or SVG file running
// scripts could use the API. Text, including HTML, is sent as plain text,
// and the sandbox policy stops scripts in anything else opened directly.
func (s *Server) content(ctx context.Context, in *pathParam) (*huma.StreamResponse, error) {
	f, fi, err := s.openFile(in.Path)
	if err != nil {
		return nil, s.fail(ctx, err)
	}
	ctype := mime.TypeByExtension(path.Ext(fi.Name()))
	if kind(fi.Name(), false) == "text" || ctype == "" {
		ctype = "text/plain; charset=utf-8"
	}
	return serveFile(f, fi, func(h http.Header) {
		h.Set("Content-Type", ctype)
		h.Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": fi.Name()}))
		// Browsers refuse to show PDFs sandboxed; their viewers run no
		// scripts of the document in the page's origin.
		if ctype != "application/pdf" {
			h.Set("Content-Security-Policy", "sandbox")
		}
	}), nil
}

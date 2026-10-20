package server

import (
	"context"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
)

// SearchResults are the entries matching a search.
type SearchResults struct {
	Entries   []FileEntry `json:"entries" nullable:"false"`
	Total     int         `json:"total" doc:"Number of all matches, of which entries holds up to limit."`
	Indexed   int         `json:"indexed" doc:"Number of files and folders in the index."`
	ScannedAt time.Time   `json:"scannedAt" doc:"End of the last scan of the root folder; zero before the first one."`
	Scanning  bool        `json:"scanning" doc:"A scan is running, so results may be out of date."`
}

type searchInput struct {
	Query string `query:"q" doc:"Space-separated terms that must all be part of a name, ignoring case."`
	Path  string `query:"path" doc:"Folder to search in; empty for the root folder."`
	Limit int    `query:"limit" default:"200" minimum:"1" maximum:"5000"`
}

func (s *Server) registerSearch(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "search",
		Method:      http.MethodGet,
		Path:        "/api/search",
		Summary:     "Search files and folders by name",
		Description: "Searches an in-memory index of the root folder, which is refreshed periodically and after changes made through the API.",
		Tags:        []string{"files"},
		Errors:      []int{http.StatusBadRequest},
	}, s.search)
}

func (s *Server) search(ctx context.Context, in *searchInput) (*response[SearchResults], error) {
	scope, err := cleanPath(in.Path)
	if err != nil {
		return nil, s.fail(ctx, err)
	}
	found, total := s.index.Search(scope, in.Query, in.Limit)
	entries := make([]FileEntry, len(found))
	for i, e := range found {
		entries[i] = FileEntry{
			Name:    e.Name,
			Path:    e.Path,
			IsDir:   e.IsDir,
			Size:    e.Size,
			ModTime: e.ModTime,
			Kind:    kind(e.Name, e.IsDir),
			Mode:    e.Mode.String(),
			Owner:   e.Owner,
			Group:   e.Group,
		}
	}
	st := s.index.Status()
	return &response[SearchResults]{SearchResults{
		Entries:   entries,
		Total:     total,
		Indexed:   st.Entries,
		ScannedAt: st.ScannedAt,
		Scanning:  st.Scanning,
	}}, nil
}

# just-files

A small web file browser for one folder: a folder tree beside the current
folder, search as you type, and drag and drop uploads of files and whole
folders.

## Run

```sh
scripts/run.sh -path ~/Documents   # Go server on :8080 + Vite dev server with hot reload
```

Or build and run the binary:

```sh
npm ci && npm run build
go build -o just-files .
./just-files -path ~/Documents     # http://localhost:8080
```

With Docker, using the image CI publishes from `main`:

```sh
docker run --rm -p 8080:8080 -e PUID="$(id -u)" -e PGID="$(id -g)" \
  -v ~/Documents:/data ghcr.io/vojty/just-files:latest
```

The container runs as `PUID`:`PGID` (default 1000:1000), who needs write
access to the folder for uploads; `PUID=0` runs as root. Nothing in the folder
is chowned.

For CasaOS, import `docker-compose.yaml` (App Store → Custom Install →
Import). It serves `/DATA` on port 1341 as root; adjust both there if needed.
`docker compose up -d` with the same file works without CasaOS.

| Flag | Environment | Default | |
|---|---|---|---|
| `-path` | `ROOT_PATH` | `.` | folder to serve |
| `-port` | `PORT` | `8080` | web UI port |
| `-ui-dir` | `UI_DIR` | `ui/dist` | folder with the built web UI |
| `-scan-interval` | `SCAN_INTERVAL` | `10m` | how often to rescan the folder for search, `0` disables |
| `-log-level` | `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |
| `-log-format` | `LOG_FORMAT` | `auto` | `auto`, `pretty`, `text` or `json` |

There is no login: anyone who can reach the port can read, change and delete
the files. Run it on a trusted network or behind an authenticating proxy.

## How it works

- **Files** are accessed through Go's `os.Root`, so no request can reach
  outside the folder, also not through `..` or symlinks. Hidden (dot) files
  are neither listed nor accessible.
- **Search** filters an in-memory index of every file and folder name
  (`internal/index`), so results come back in milliseconds instead of walking
  the disk per query. The index is rebuilt by a full walk at startup, every
  `-scan-interval`, and about a second after changes made in the UI. Changes
  made to the folder by other programs show up in search after the next scan;
  browsing always shows the folder as it is on disk.
- **Uploads** stream to a hidden `.name.part` file that is renamed when
  complete, so partial uploads never show. Dropped folders are walked in the
  browser and their files uploaded into the same structure.

## Development

`scripts/run.sh` rebuilds and restarts the Go server when Go files change, and
regenerates the API client when the API changed; Vite reloads the UI.

CI (`.github/workflows/ci.yml`) checks every commit: Go formatting, vet and
tests, and the UI's types, lint, unused code, formatting, tests and build. It
also fails when the committed generated files are out of date. After the checks
pass, it builds the Docker image for amd64 and arm64 and publishes it to
`ghcr.io/vojty/just-files` from `main` (`latest`) and `v*` tags.

The API is described by an OpenAPI document generated from the Go handlers
(`internal/server`), and the UI's TypeScript client is generated from it.
After changing the API, run `scripts/gen-api.sh` and commit `openapi.json`
and `ui/src/client`.

```sh
go test ./...
npm run typecheck && npm run lint && npm run knip && npm run fmt:check && npm test
```

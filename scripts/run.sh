#!/usr/bin/env bash
# Starts the Go server and the Vite dev server for local testing, reloading
# both on changes: Vite reloads the UI itself, and this script rebuilds and
# restarts the Go server when Go files change.
# Extra arguments are passed to the Go server, e.g.:
#   scripts/run.sh -path ~/Documents -log-level debug
# Stop both with Ctrl-C. VITE_PORT sets the dev server's port (5173).
set -euo pipefail

cd "$(dirname "$0")/.."

npm install
scripts/gen-api.sh

# Each run has its own files, so two runs (see VITE_PORT) do not clash.
tmp=$(mktemp -d)
bin="$tmp/just-files-dev"
spec="$tmp/openapi.json"
# Go files changed after this file are rebuilt; made before the first build,
# so changes during it are not missed.
stamp="$tmp/built"
touch "$stamp"

# Only processes started here are ever signalled, and only while they run as
# jobs of this shell: a PID saved in a variable may already belong to an
# unrelated process once ours ended, but a running job's PID cannot.
running() { [ -n "$1" ] && jobs -pr | grep -qx "$1"; }

cleanup() {
	trap - EXIT
	local jobs
	jobs=$(jobs -pr)
	if [ -n "$jobs" ]; then
		# shellcheck disable=SC2086 # one PID per word
		kill $jobs 2>/dev/null || true
	fi
	wait 2>/dev/null || true
	rm -rf "$tmp"
}
trap cleanup EXIT
# Ctrl-C or kill: exit, which runs cleanup.
trap 'exit 130' INT
trap 'exit 143' TERM

go build -o "$bin" .

# The Go server's port, for the Vite proxy (vite.config.ts) and to wait for it.
port="${PORT:-8080}"
args=("$@")
for i in "${!args[@]}"; do
	case "${args[$i]}" in
	-port | --port) port="${args[$((i + 1))]:-$port}" ;;
	-port=* | --port=*) port="${args[$i]#*=}" ;;
	esac
done
export API_PORT="$port"
vite_port="${VITE_PORT:-5173}"

listening() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
for p in "$port" "$vite_port"; do
	if listening "$p"; then
		echo "run.sh: port $p is already in use, is another just-files still running?" >&2
		exit 1
	fi
done

go_pid=
start_go() {
	# The arguments may be none, which bash 3.2 calls unset with set -u.
	"$bin" ${args[@]+"${args[@]}"} &
	go_pid=$!
}
stop_go() {
	if running "$go_pid"; then
		kill "$go_pid"
		wait "$go_pid" 2>/dev/null || true
	fi
	go_pid=
}

start_go

# Start Vite only once the Go server listens, so a server that cannot start
# ends the script with its error in view.
until listening "$port"; do
	if ! running "$go_pid"; then
		echo "run.sh: the Go server did not start, see the error above" >&2
		exit 1
	fi
	sleep 0.1
done

# Run Vite itself, not through npm: npm and sh would be the processes killed
# on exit, leaving Vite running.
node_modules/.bin/vite --port "$vite_port" &
vite_pid=$!

changed() {
	[ -n "$(find . -path ./node_modules -prune -o \( -name '*.go' -o -name go.mod -o -name go.sum \) \
		-newer "$stamp" -print -quit)" ]
}

# Regenerates the API contract when the API changed, so the UI gets its new
# types; Vite reloads the UI then.
update_api() {
	if go run ./cmd/openapi >"$spec" && ! cmp -s "$spec" openapi.json; then
		echo "run.sh: the API changed, regenerating openapi.json and ui/src/client" >&2
		scripts/gen-api.sh || echo "run.sh: regenerating the API client failed" >&2
	fi
}

# Watch for changes once a second (macOS has no inotify, bash 3.2 no `wait -n`).
while :; do
	if ! running "$vite_pid"; then
		echo "run.sh: Vite stopped, stopping the Go server" >&2
		exit 1
	fi
	if [ -n "$go_pid" ] && ! running "$go_pid"; then
		echo "run.sh: the Go server stopped; it restarts after the next change" >&2
		go_pid=
	fi
	if changed; then
		touch "$stamp"
		echo "run.sh: Go files changed, rebuilding" >&2
		# A separate file: a running program's file cannot be overwritten.
		if go build -o "$bin.new" .; then
			stop_go
			mv "$bin.new" "$bin"
			start_go
			update_api
		else
			echo "run.sh: the build failed, the previous server keeps running" >&2
		fi
	fi
	sleep 1
done

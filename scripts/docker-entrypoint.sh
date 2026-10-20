#!/bin/sh
# Container entrypoint. Started as root, it runs just-files as PUID:PGID
# (default 1000:1000), so uploaded files belong to that user. PUID=0 keeps
# root, e.g. for folders only root can write to. Started as another user
# (`user:` / `--user`), it runs just-files directly.
#
# Only /config, the app's own folder for its settings, is handed to
# PUID:PGID; the data in /data keeps its owners.
set -e

if [ "$(id -u)" = 0 ] && [ "${PUID:-1000}" != 0 ]; then
	chown -R "${PUID:-1000}:${PGID:-1000}" /config
	exec su-exec "${PUID:-1000}:${PGID:-1000}" /usr/local/bin/just-files "$@"
fi
exec /usr/local/bin/just-files "$@"

FROM --platform=$BUILDPLATFORM node:24-alpine AS ui
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts vite.file-icons.ts ./
COPY ui ./ui
RUN npm run build

FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS build
ARG TARGETOS TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /just-files .

FROM alpine:3
RUN apk add --no-cache tzdata su-exec \
 && mkdir /config
COPY --from=build /just-files /usr/local/bin/just-files
COPY --from=ui /src/ui/dist /usr/share/just-files/ui
COPY --chmod=755 scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Runs as PUID:PGID (default 1000:1000), who must be able to write to the
# folder mounted at /data; see scripts/docker-entrypoint.sh. Settings changed
# in the web UI are saved in /config.
ENV PUID=1000 PGID=1000 \
    ROOT_PATH=/data \
    CONFIG_FILE=/config/settings.json \
    UI_DIR=/usr/share/just-files/ui
VOLUME ["/config"]
EXPOSE 8080/tcp
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

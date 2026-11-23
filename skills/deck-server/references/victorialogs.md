# VictoriaLogs on a Dokploy server

Why: Dokploy's log viewer shows only the current container; a redeploy loses the history. VictoriaLogs keeps
every container's lines for the retention period, is one small service, and answers one HTTP query
(`logs.py`), so an agent of any vendor can read it.

## 1. Store

A compose app in its own Dokploy project "Logs" (one per server, or one per cluster):

```yaml
services:
  victorialogs:
    image: victoriametrics/victoria-logs:v1.54.0   # pin; newer: github.com/VictoriaMetrics/VictoriaLogs/releases
    command:
      - -storageDataPath=/vlogs
      - -retentionPeriod=30d
      - -retention.maxDiskSpaceUsageBytes=10GiB
      - -httpAuth.username=${VL_USER}
      - -httpAuth.password=${VL_PASSWORD}
    volumes: [vlogs:/vlogs]
    expose: ["9428"]
    networks: [dokploy-network]
    restart: always
    healthcheck:
      test: ["CMD", "/victoria-logs-prod", "-healthcheck"]   # /health sits behind the basic auth too
      interval: 30s
    logging: {driver: json-file, options: {max-size: 10m, max-file: "3"}}
volumes:
  vlogs:
networks:
  dokploy-network:
    external: true
```
`VL_USER`/`VL_PASSWORD`: generated on the agent's side, saved in Dokploy's env for the app and in
`~/.config/victorialogs/<project>.env` as `VICTORIALOGS_URL`, `VICTORIALOGS_USER`, `VICTORIALOGS_PASSWORD`.
A domain (`logs.<client domain>`, HTTPS) only for the agent's queries; the UI is at `/select/vmui`.

## 2. Collection

**First try Dokploy's own exporter** (Settings → Logs & Metrics, where the installed version has it): a Vector
agent per server that ships container logs to an external store. Point its Loki target at
`http://victorialogs:9428/insert/loki/api/v1/push` with the basic auth above. Check with `logs.py containers`
that every app shows up, also apps on worker nodes.

**Otherwise our own Vector**, one per server (Swarm: `deploy: {mode: global}`):

```yaml
  vector:
    image: timberio/vector:<pinned>-alpine
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./vector.toml:/etc/vector/vector.toml:ro
    environment: [VL_USER, VL_PASSWORD]
    networks: [dokploy-network]
    restart: always
```
```toml
[sources.docker]
type = "docker_logs"
exclude_containers = ["victorialogs", "vector"]

[sinks.vlogs]
type = "elasticsearch"
inputs = ["docker"]
endpoints = ["http://victorialogs:9428/insert/elasticsearch/"]
api_version = "v8"
compression = "gzip"
healthcheck.enabled = false
auth.strategy = "basic"
auth.user = "${VL_USER}"
auth.password = "${VL_PASSWORD}"

[sinks.vlogs.query]
_msg_field = "message"
_time_field = "timestamp"
_stream_fields = "host,container_name"
```

## 3. Check

- `logs.py containers --since 15m` lists every running app.
- Redeploy one app, then `logs.py query 'container_name:~"<app>"' --since 30m` still shows the lines from
  before the redeploy.
- RAM of the two containers after a day (Beszel): report it. Expect a few hundred MB at small volume.
- Add the source to the profile: `{"id": "logs", "kind": "victorialogs", "env": "~/.config/victorialogs/<project>.env"}`.

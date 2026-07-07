# Redis Scanner

Redis Scanner safely discovers Redis-compatible databases (Redis OSS, Redis Enterprise, Valkey, KeyDB where possible) on networks you are authorized to scan, and provides read-only inventory through a CLI and a lightweight Web UI. It never writes to a scanned instance, never stores or logs credentials, and never brute-forces passwords.

> **Only scan networks and hosts you are authorized to test.**

## Contents

- [Prerequisites](#prerequisites)
- [Install & build](#install--build)
- [Quick start](#quick-start)
- [CLI reference](#cli-reference)
- [Web UI guide](#web-ui-guide)
- [HTTP API](#http-api)
- [Security & responsible use](#security--responsible-use)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Docker](#docker)

## Prerequisites

- Node.js 22 or later
- npm

## Install & build

```bash
git clone <this repo>
cd RedisScanner
npm install
npm run build
```

`npm run build` compiles TypeScript to `dist/` and copies the Web UI's static assets (HTML/CSS/JS plus a locally-vendored copy of HTMX — no CDN, nothing is fetched from the network) into `dist/web/public/`.

Run the CLI directly:

```bash
node dist/cli/index.js --help
```

Or make `rscan` available as a command:

```bash
npm link          # from the project directory
rscan --help
```

## Quick start

Scan your local machine for Redis on the default port:

```bash
rscan scan -c 127.0.0.1/32
```

Scan a subnet across a few common ports:

```bash
rscan scan -c 10.0.0.0/24 -p 6379,6380-6385
```

No CIDR given? It auto-detects your local non-loopback subnets (capped at a /24 per interface) instead of scanning nothing:

```bash
rscan scan
```

Start the Web UI:

```bash
rscan serve
# then open http://localhost:3000
```

## CLI reference

### `rscan scan`

| Flag | Default | Description |
|---|---|---|
| `-c, --cidr <target>` | auto-detected local subnets | CIDR, IP, or hostname to scan. Repeatable: `-c 10.0.0.0/24 -c redis.example.com`. Hostnames are resolved via DNS (IPv4/A records only) and every resolved address is scanned. Add `:port` (e.g. `-c redis.example.com:6380`) to scan that target on a specific port instead of `-p`. |
| `-p, --port <ports>` | `6379` | Ports to scan — a single port, comma list, or ranges: `6379,6380-6385` |
| `-t, --timeout <ms>` | `1000` | Per-connection timeout in milliseconds |
| `--concurrency <n>` | `100` | Max concurrent connection attempts |
| `--tls` | off | Attempt TLS first; automatically falls back to plain on handshake failure |
| `--tls-skip-verify` | off | Skip TLS certificate verification (needed for self-signed certs) |
| `--username <user>` | — | ACL username for authentication; requires `--password` |
| `--password <pass>` | — | Password to authenticate with. Used only for this scan — never logged, printed, or persisted anywhere |
| `--json` | off | Print results as a JSON array instead of a table |

Progress and the final summary are written to stderr; results (table or JSON) are written to stdout, so you can pipe just the data:

```bash
rscan scan -c 10.0.0.0/24 --json > results.json
```

Exits `0` on a completed scan (including zero instances found) and `1` on a usage/input error (invalid CIDR, invalid port spec, `--username` without `--password`, or a CIDR range too large to scan — see [Troubleshooting](#troubleshooting)).

### `rscan serve`

| Flag | Default | Description |
|---|---|---|
| `--port <port>` | `3000` | HTTP port to listen on |
| `--host <host>` | `localhost` | HTTP host to bind |

```bash
rscan serve --port 8080 --host 0.0.0.0
```

The server is entirely local — it doesn't call out to any external service. Bind to `0.0.0.0` only if you understand you're exposing the scan/authenticate endpoints to your network.

## Web UI guide

Open the address `rscan serve` prints (default `http://localhost:3000`). Four pages, linked from the top nav:

- **Dashboard** — configure and start a scan: targets (CIDR ranges, bare IPs, or hostnames, one per line — hostnames are resolved via DNS and every resolved address is scanned), ports, timeout, concurrency, TLS options, and optional credentials for this scan only. Any target line may end in `:port` (e.g. `redis.example.com:6380`, or `10.0.0.0/24:6380`) to scan just that target on that port instead of the shared Ports field. Submitting takes you to Results. Non-credential fields are remembered for the rest of the browser tab's session (via `sessionStorage`), so navigating to Results and back doesn't lose what you typed — closing the tab or browser clears it.
  - **Upload CSV** — load targets from a CSV file instead of typing them: one target per line, `host` or `host,port` (a header row is skipped automatically). The file is read entirely in the browser and never uploaded to the server; it just replaces the Targets field, encoding each row with a port as `host:port` so that row is scanned on exactly its own port rather than every port seen in the file. It applies the same Timeout/Concurrency/TLS/credentials fields to every target — there's no way yet to give individual targets their own credentials via the file.
- **Results** — a target banner showing what's being (or was) scanned, live status and progress while a scan runs, then a table of discovered instances: host, port, TLS, TLS certificate + expiry, product, version, auth status, role, mode, cluster state, connected replica count, what it's replicating from (for a replica), memory usage, key count, loaded modules, OS, uptime, latency, and run ID. Each row has an **Authenticate** button that opens a dialog for that host's credentials — submitting re-probes with them and updates the row's inventory in place. **Export CSV** downloads the current results with the same columns.
  - **TLS certificate info without credentials** — for any TLS target, the certificate's subject, issuer, expiry, and whether it's self-signed or CA-issued/trusted are read straight off the TLS handshake, independent of Redis-level auth. This is the one piece of real information available for a host that requires authentication you don't have — the "TLS Cert"/"Cert Expires" columns (and every other inventory column) still show `—` for that row, but the certificate columns don't, since the handshake already happened before AUTH was ever attempted.
  - **Same-database detection** — if two or more results report the same Run ID (Redis's own per-process identifier), a banner appears above the table and each affected row gets a "⚠ dup" badge on its Run ID. This means the same database is reachable through more than one endpoint — for example, a Redis Enterprise database whose proxy answers on every cluster node. Without this, scanning all of a cluster's node IPs would look like several independent databases that happen to have identical version/module/everything data, when it's really one database reachable multiple ways. The CLI table prints the same warning below its output; CSV/JSON just carry the raw Run ID for each row so you can group them yourself.
  - **Pause** / **Resume** — freezes and resumes a running scan. Already-open connections finish naturally; nothing new starts until you resume.
  - **Stop** — ends the scan immediately, keeping whatever results were found so far.
  - **Restart** — re-runs the last scan's exact targets and options. Credentials are never persisted, so a restarted scan always runs anonymously — re-authenticate per host with the Authenticate button if needed.
- **Settings** — non-sensitive scan defaults (ports, timeout, concurrency, TLS options) that pre-fill the Dashboard form. These are stored only in your browser's `localStorage` and are never sent anywhere until you actually start a scan. Credentials are never stored here or anywhere else.
- **About** — a summary of the tool's principles and non-goals.

Only one scan runs at a time; starting a new one while another is in progress (scanning or paused) returns a conflict until it's finished or stopped.

## HTTP API

`rscan serve` exposes the same API the Web UI uses, if you want to script against it:

| Method & path | Purpose |
|---|---|
| `POST /api/scan` | Start a scan. Body: `{ cidrs?, ports?, timeoutMs?, concurrency?, tls?, tlsSkipVerify?, username?, password? }`. Returns `202` or `409` if one's already running or paused. |
| `POST /api/scan/pause` | Pause the running scan. `409` if none is running. |
| `POST /api/scan/resume` | Resume a paused scan. `409` if none is paused. |
| `POST /api/scan/stop` | Stop the running or paused scan, keeping results found so far. `409` if neither. |
| `POST /api/scan/restart` | Re-run the last scan's targets and options (never its credentials). `400` if there's no previous scan, `409` if one is currently running or paused. |
| `GET /api/results` | Current scan status (`idle`, `scanning`, `paused`, `done`, `error`, or `stopped`), progress, targets, and results. |
| `POST /api/authenticate` | Lightweight auth check against a single host — `{ host, port, username?, password }` → `{ authenticated, wrongPassword }`. Doesn't update scan state. |
| `POST /api/inventory` | Authenticate against a single host **and** return/update its full inventory — `{ host, port, username?, password }` → the updated result. This is what the Results page's Authenticate dialog uses. |
| `GET /api/export/csv` | Download current results as CSV. |

Credentials are accepted in request bodies (never in a URL) and are never echoed back in any response, logged, or persisted.

Each result's `inventory` includes `replication` (connected replicas, or master host/port/link status if this node is itself a replica), `memory` (used bytes, max memory, eviction policy), `keyspace` (per-database key/expiry counts), `modules` (name + version of anything loaded via `MODULE LIST`), `clusterInfo` (state and slot coverage, populated only when the node reports cluster mode), and `runId` (from `INFO`'s `run_id` — the same value across every endpoint that's actually the same running server; see "Same-database detection" above).

Each result also has a top-level `tlsCertificate` field — sitting *outside* `inventory`, not inside it, since it's read from the TLS handshake itself and stays populated even when `inventory` is `null` because auth is required. It's `null` for plaintext connections. Fields: `subject`, `issuer`, `validFrom`/`validTo`, `selfSigned` (issuer equals subject), `trusted` (chain validated against Node's CA store), and `fingerprint256`.

## Security & responsible use

> **Only scan networks and hosts you are authorized to test.** Everything below describes what Redis Scanner does and does not do technically — it does not grant authorization to scan anything.

This section is written for a security reviewer deciding whether to allow this tool against your infrastructure. Every claim below was verified directly against this version of the source (including a live capture of the exact bytes sent over the wire), not written from memory of how it's "supposed to" work — file references are given so you can check any of it yourself.

**Summary, if you read nothing else:** Redis Scanner does a TCP connect scan, then — on open ports — a short, fixed sequence of read-only Redis commands (never more than `AUTH`, `PING`, `INFO`, `MODULE LIST`, `CLUSTER INFO`). It never sends a command that writes data, changes configuration, or alters cluster/replication state. Credentials are used for exactly one login attempt and are never logged, persisted, or echoed back. Everything lives in memory for the life of the process — no disk writes, no outbound calls to anything other than the hosts you asked it to scan. The one thing that genuinely needs your attention before deployment is that the Web UI's HTTP API has no authentication of its own — see "Web UI exposure" below before binding it to anything other than `localhost`.

**What a scan actually does, in order:**
1. A plain TCP connect to each host:port ([src/scanner/tcp.ts](src/scanner/tcp.ts)) — a full three-way handshake, immediately closed, timing out per your `-t/--timeout`. No data is sent at this stage. This is a standard TCP connect scan, the same technique as `nc -zv` or `nmap -sT` — not a half-open/SYN scan, not fragmented, no spoofed source address, no timing jitter or other evasion. It will appear in any firewall or connection log exactly as an ordinary, unremarkable connection attempt.
2. On each port that accepts a connection, a Redis protocol probe opens ([src/probe/index.ts](src/probe/index.ts)), optionally preceded by a TLS handshake (see below). We captured the exact command sequence sent over this connection empirically rather than describing it from the code alone; in order, it is always a subset of:
   - `CLIENT SETINFO LIB-NAME ...` / `CLIENT SETINFO LIB-VER ...` — sent automatically by the underlying `ioredis` client library itself before anything else, purely to self-identify the client. This isn't a command Redis Scanner's own code requests; it's default behavior of the Redis client library it's built on, and you'll see it in logs on the target side.
   - `AUTH <password>` or `AUTH <username> <password>` — **only** if you supplied credentials for that scan. Exactly one attempt, using exactly the credential you gave it. There is no retry loop, no wordlist, and no code path anywhere in this project that tries a second credential — if it's rejected, the target is reported as such and left alone.
   - `PING` — a liveness check.
   - `INFO` — the main data-gathering step. Read-only; returns server metadata and statistics.
   - `MODULE LIST` — read-only; lists loaded modules.
   - `CLUSTER INFO` — only sent if `INFO` reported the node is in cluster mode. Read-only.

   That's the complete, exhaustive list. `AUTH`, `PING`, `INFO`, `MODULE LIST`, and `CLUSTER INFO` are all documented as read-only in Redis's own command reference; none of them mutate keyspace data, configuration, or replication/cluster state. If authentication is required and not supplied (or is wrong), the sequence stops after `AUTH`/on the first `NOAUTH` — nothing past that point is ever sent.

**TLS and certificate verification** ([src/probe/index.ts](src/probe/index.ts)): with `--tls`/`tls: true`, a TLS handshake is attempted before any of the commands above; on handshake failure it automatically falls back to a plain connection. The peer certificate is read directly off the socket as part of that handshake — before any RESP command, including `AUTH` — which is why certificate metadata (subject, issuer, validity window, self-signed vs. CA-trusted, SHA-256 fingerprint) is captured even for a host that requires credentials you don't have.

One deliberate, non-default piece of TLS behavior is worth calling out explicitly: Node's usual hostname/SAN verification (does the certificate list the name you connected to) is intentionally disabled via `checkServerIdentity: () => undefined`. This tool always connects by resolved IP address, never by the original hostname, and a real certificate's SAN list only ever contains DNS names — never IP addresses — so the standard hostname check would reject every legitimately-issued certificate on IP-based reconnaissance regardless of whether it's genuinely trustworthy. **This bypass affects only hostname matching.** Chain-of-trust verification — signature validity, CA trust, and expiry — is untouched: `rejectUnauthorized` and the resulting `trusted` field on each result still fully reflect whether the certificate chains to a trusted CA and hasn't expired, and an expired or self-signed certificate is still correctly reported as untrusted (see the tests in [test/unit/probe/probe.test.ts](test/unit/probe/probe.test.ts)). The reasoning: hostname verification exists to stop a MITM from impersonating one specific hostname to a client that already trusts that name; that threat model doesn't apply to a scanner doing IP-based discovery with no specific hostname identity to protect. `--tls-skip-verify` is a separate, off-by-default flag that goes further and disables chain-of-trust checking too, for self-signed or internal-CA deployments.

**Credential handling, precisely:** a supplied password/username is held only as a local variable, passed directly into one `ioredis` `AUTH` call, and never assigned anywhere else. We verified this by (a) capturing the wire traffic directly, confirming exactly one `AUTH` per credentialed attempt and nothing resembling a retry, and (b) grepping every reference to `password` across the entire source tree — every one is a type declaration, a validation check, or a direct pass-through into the `AUTH` call; none reach `console.log`, `process.stdout`/`stderr.write`, an HTTP response body, a thrown error message, or any persisted structure. The in-memory scan state ([src/web/state.ts](src/web/state.ts)) has no field capable of holding a credential. The Settings page persists only non-sensitive defaults (ports/timeout/concurrency/TLS flags) to the browser's `localStorage` — never credentials. One caveat outside this project's own code: the `ioredis` dependency can print command arguments, including `AUTH` credentials, to stderr if *you* set the `DEBUG=ioredis:*` environment variable yourself. Redis Scanner never sets this; don't enable it while scanning with credentials.

**Data handling and storage:** everything — scan state, in-progress results, authenticated inventory — lives in a single in-memory object for the life of the `rscan serve` process ([src/web/state.ts](src/web/state.ts)); nothing is written to disk, and stopping or restarting the process discards it all. We verified there are zero outbound network calls anywhere in the server-side code other than connections to the hosts you asked it to scan — no telemetry, no update checks, no analytics, no "phone home" of any kind. The CLI writes results to stdout only because you asked it to (`--json > results.json` or similar); once you've redirected it to a file, that file is exactly as sensitive as any other network inventory document (it can include topology, version, module, and replication data) and should be handled with the same care — that's an operational responsibility on your side, not something this tool manages for you. The same applies to CSV exports from the Web UI.

**Network footprint and safety guardrails:** connection concurrency is bounded by `--concurrency`/the Dashboard's Concurrency field (default 100), and every scan request is rejected outright if its combined target count across all CIDRs exceeds 65,536 hosts ([src/scanner/cidr.ts](src/scanner/cidr.ts)) — enough to stop an accidental `/8` from trying to expand into millions of targets before scanning even starts, but this is a default ceiling the operator controls via how they invoke the tool, not a hard technical limit on how many scans can be run one after another. There is no code path that retries a target with different credentials, times attempts to evade rate-based detection, or otherwise tries to avoid being noticed.

**Web UI exposure — read this before binding beyond `localhost`:** `rscan serve`'s HTTP API ([src/web/index.ts](src/web/index.ts)) has **no authentication, authorization, or rate limiting of its own**. Anyone who can reach the bound host:port can start scans, read all current and past results, and use the Authenticate feature — which means submitting a host, port, username, and password *of their own choosing* and having the machine running Redis Scanner attempt that login on their behalf. Concretely: if you bind to `0.0.0.0` (or any interface reachable by users you don't fully trust with this tool's full capability), you are running an unauthenticated network-reachability and credential-testing proxy for everyone on that network segment — they can direct it at any host:port the Redis Scanner machine itself can reach, including internal hosts they couldn't otherwise reach directly. **Bind to `localhost` (the default) unless every potential user of that network segment is already someone you'd trust to run this tool themselves.** Two narrower mitigations are actually present in the code: a `Referrer-Policy: no-referrer` header is set on every response, and every POST endpoint requires a `Content-Type: application/json` body, which incidentally defeats the simplest classic HTML-form CSRF pattern (a plain `<form>` can't submit JSON) — but no CSRF token is issued or checked, so this is not a substitute for real CSRF protection if you expose the UI to a browser-based user population beyond a single trusted operator. The Web UI's own listener is plain HTTP, by design, for a tool meant to run locally — if you bind it to a non-loopback interface, traffic between a browser and `rscan serve` (including anything typed into the Authenticate dialog) crosses that network segment in cleartext.

**Dependency surface:** exactly three runtime dependencies — `commander` (CLI parsing), `express` (HTTP server), `ioredis` (Redis protocol client) — see [package.json](package.json). No ORM, no template engine, no analytics SDK, nothing else with its own network or filesystem access. The Docker image is a two-stage build; the final runtime image contains no TypeScript source, test files, or dev tooling (see [Docker](#docker)).

**What this tool will never do, by construction rather than configuration:** the complete set of Redis commands it can ever send is `AUTH`, `PING`, `INFO`, `MODULE LIST`, and `CLUSTER INFO`, plus the `CLIENT SETINFO` calls the `ioredis` library sends on its own — there is no `CONFIG SET`, no `FLUSHALL`/`FLUSHDB` or any other keyspace-mutating command, no `SHUTDOWN`, no cluster-mutating admin command, no `EVAL`/Lua scripting, no `MODULE LOAD`. There's no console or REPL feature and no way for a user of this tool to send an arbitrary Redis command through it — the command set is hardcoded, not user-composable. There's no brute-force or credential-guessing logic, and no scheduling or recurring-scan feature — each invocation is a single, bounded, one-shot operation.

**Recommended deployment posture:**
- Only scan hosts and networks you're authorized to test — this is a discovery tool, not an authorization mechanism.
- Prefer the CLI, or `rscan serve` bound to its `localhost` default, for anything beyond a single trusted operator on a trusted machine.
- If you must bind the Web UI beyond `localhost`, put it behind your own authenticating reverse proxy — Redis Scanner provides none of its own.
- Treat scan output (stdout, `--json`, exported CSV) as sensitive network reconnaissance data and store/transmit it under the same controls you'd apply to any other infrastructure inventory.
- Don't set `DEBUG=ioredis:*` in the environment `rscan` runs in while scanning with credentials.

## Troubleshooting

**"No Redis instances found."** — Ports are closed, filtered, or the timeout is too short for the network path. Try a larger `-t/--timeout`, confirm the target is reachable (`nc -zv <host> <port>`), and double-check the port list.

**A live Redis reports as "not Redis."** — If you're scanning through a restrictive ACL, confirm the account can at least run `INFO` (PING alone being denied is handled correctly and won't cause this). A closed port or a non-RESP service on that port will also show this way — that's by design.

**"Scan target too large: N hosts requested... (max 65536)."** — Your combined CIDR ranges exceed the safety cap. Scan a smaller or more specific range, or run multiple scans.

**"Could not resolve hostname ... ENOTFOUND" or the scan just fails when using a hostname target.** — The whole scan is rejected if any one hostname target fails to resolve, the same way an invalid CIDR is rejected. Double-check the spelling and that it resolves from this machine (`nslookup <hostname>` or `dig <hostname>`). Hostnames resolve to IPv4 addresses only (A records) — a host with only an IPv6 (AAAA) record won't resolve, since scanning is IPv4-only throughout.

**TLS scan falls back to plain unexpectedly.** — A TLS handshake failure (wrong port, non-TLS server, or an untrusted cert without `--tls-skip-verify`) causes an automatic fallback to a plain connection. If the plain attempt also fails, the host is reported as not found.

**`npm run build` says it can't find `node_modules/htmx.org`.** — Run `npm install` first; the build step vendors HTMX from `node_modules` and needs it installed.

**Web UI shows "Could not reach the server."** — `rscan serve` isn't running, or you navigated to a different port/host than it's bound to.

## Development

```bash
npm run typecheck        # tsc, both the app and test project
npm test                 # unit tests (mocked servers, no network required)
npm run test:integration # integration tests (spawns the built CLI, needs a live Redis)
npm run lint
npm run format            # or format:check
```

Integration tests default to a plain Redis on `127.0.0.1:6379` and Valkey on `127.0.0.1:6380`. Override or extend coverage with environment variables — all optional, tests requiring an unset one are skipped:

| Variable | Enables |
|---|---|
| `REDIS_8_PORT` | Redis target port (default `6379`) |
| `VALKEY_PORT` | Valkey target port (default `6380`) |
| `REDIS_7_HOST` / `REDIS_7_PORT` | Additional Redis 7.x coverage |
| `REDIS_TLS_HOST` / `REDIS_TLS_PORT` | TLS-enabled Redis coverage |
| `REDIS_AUTH_HOST` / `REDIS_AUTH_PORT` / `REDIS_AUTH_PASSWORD` | Password-protected Redis coverage |

Project layout: `src/scanner` (CIDR/port expansion, TCP probing, concurrency), `src/probe` (Redis protocol detection + INFO parsing), `src/inventory` (assembles the discovery pipeline), `src/cli`, `src/web` (Express API + static Web UI in `src/web/public/`), `src/export` (CSV).

## Docker

The `Dockerfile` builds entirely from local files — it doesn't need this repo to be on GitHub or any remote. It's a two-stage build: a `build` stage with full `npm ci` (TypeScript, and `htmx.org` — a devDependency whose only job is to be vendored into `dist/web/public/htmx.min.js` at build time) compiles the app, then a fresh `runtime` stage installs only production dependencies and copies in the compiled `dist/`. The final image never contains TypeScript, test files, or dev tooling.

```bash
docker build -t redis-scanner .
```

Runs the Web UI by default (the image's `ENTRYPOINT` is the CLI; the default `CMD` is `serve --host 0.0.0.0 --port 3000` — binding `0.0.0.0`, not `localhost`, is required so it's reachable from outside the container):

```bash
docker run --rm -p 3000:3000 redis-scanner
# open http://localhost:3000
```

Any extra arguments after the image name override the default `CMD`, so the same image runs one-shot scans too:

```bash
docker run --rm redis-scanner scan -c 10.0.0.0/24 -p 6379,6380
```

### The one thing that's genuinely different in a container: networking

Redis Scanner's core job is discovering what's on your network — and a container has its *own* network by default, not your machine's. This is the one place containerizing this specific tool needs extra thought, not just Docker boilerplate. Concretely, on this exact setup:

```
$ docker run --rm redis-scanner scan -c 127.0.0.1/32 -p 6379,6380
No Redis instances found.                     # the container's own loopback, not the host's

$ docker run --rm redis-scanner scan -p 6379  # no -c → auto-detects local subnets
Auto-detected CIDRs: 172.17.0.0/24            # Docker's internal bridge network, not your LAN

$ docker run --rm --network host redis-scanner scan -p 6379
Auto-detected CIDRs: 192.168.65.0/24, ...     # now it sees the real network
```

- **Scanning an explicit external target** (`-c <real-LAN-CIDR>`) generally works fine over the default bridge network — outbound connections are NAT'd through the host like any other container traffic.
- **Scanning `127.0.0.1` or letting it auto-detect local subnets** (omitting `-c`) reflects the *container's* loopback/network, not your machine's, unless you run with `--network host`. On Linux this shares the host's network namespace directly. On Docker Desktop (Mac/Windows) it's improved a lot in recent versions and worked correctly when tested above — but treat it as something to verify on your own Docker Desktop version rather than assumed.
- To reach a service on the host machine itself without `--network host`, use the special DNS name `host.docker.internal` — but resolve it to an IP first, since `-c` takes a literal CIDR, not a hostname:
  ```bash
  docker run --rm redis-scanner scan -c $(docker run --rm node:22-alpine node -e "require('dns').lookup('host.docker.internal',(e,a)=>console.log(a))")/32 -p 6379
  ```

If you're running the Web UI in a container and using its Dashboard with a blank CIDR field (auto-detect), the same caveat applies — you'll see the container's network, not your LAN, unless you add `--network host` to the `docker run` command that starts it.

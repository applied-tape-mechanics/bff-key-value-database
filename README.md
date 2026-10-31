# Brainfuck Key-Value Database (`bff-key-value-database`)

> **[Applied Tape Mechanics](https://github.com/applied-tape-mechanics)** — *Empirical computation and discrete field dynamics on minimal linear substrates.*
> *Enterprise-grade cloud microservices—except the core business logic is pure Brainfuck. Best Friends Forever (`BFF`) with the most hostile programming language ever created.*

An in-memory key-value database whose physical storage medium is a **65,536-cell (`64k`) Brainfuck memory tape**. Keys are hashed by a pure-Brainfuck program ([`bf/hash.bf`](bf/hash.bf)), and records are stored directly on the VM tape in 256 open-addressed buckets. Try the **[Live Interactive Demo & Tape Hex Inspector on GitHub Pages](https://applied-tape-mechanics.github.io/bff-key-value-database/)** (running 100% client-side in your browser via the JavaScript Brainfuck VM), or run the full TypeScript [Fastify](https://fastify.dev) microservice locally/in Docker for the REST API and interactive OpenAPI/Swagger documentation (`/docs`).

---

## 📦 Repository Structure & File Reference

```text
bff-key-value-database/
├── bf/
│   ├── hash.bf                # Pure Brainfuck 8-bit modular key-hashing program (`,[[->+<],]>.`)
│   └── README.md              # Step-by-step execution trace & hashing algorithm documentation
├── src/
│   ├── server.ts              # HTTP server entry point (reads PORT & DISABLE_BACKEND)
│   ├── app.ts                 # Fastify REST API routes (/db, /stats, /tape, /clear, /bf) & Web UI
│   ├── engine.ts              # 65,536-cell (64k) BrainfuckKVDB storage engine with linear probing & tombstones
│   └── index.html             # Interactive Web UI with Live Memory Tape Hex Inspector & Client JS VM fallback
├── test/
│   └── kvdb.test.ts           # 33 automated tests (BF hashing, CRUD, collision chains, tombstones & HTTP API)
├── Dockerfile                 # Multi-stage Node 24 container (base, test, and production stages)
├── docker-compose.yml         # Production service (port 8008 -> 8000), Brainfuck healthcheck sidecar & test runner
├── package.json               # Service metadata, scripts & pinned bff-interpreter dependency
├── tsconfig.json              # TypeScript configuration
└── LICENSE                    # MIT License
```

---

## ✨ Architecture & Features

- **Tape Memory as Storage Medium (`src/engine.ts`)**:
  - The Brainfuck virtual machine's 65,536-cell (`64k`) 8-bit tape (`Uint8Array(65536)`) stores all keys, values, and bucket state flags across requests with zero unused cells.
- **Pure Brainfuck Key Hasher (`bf/hash.bf`, `,[[->+<],]>.`)**:
  - Computes an 8-bit hash bucket index (`0..255`) by reading null-terminated key bytes from `stdin` and accumulating their sum in `c1` with natural 8-bit modular wrapping (`sum(key_bytes) mod 256`).
  - Snapshots and restores the working area (`c0..c255`) before and after hashing so bucket storage is never disturbed.
- **Open Addressing, Linear Probing & Tombstones**:
  - Resolves hash collisions via linear probing across 256 buckets (`(hash + probe) mod 256`).
  - Deletions write a tombstone marker (`2`) so probe chains remain intact for subsequent lookups and re-insertions.
- **Zero-Submodule Runtime UI & Client-Side Fallback**:
  - Loads [`bff-ui`](https://github.com/applied-tape-mechanics/bff-ui) and [`bff-interpreter`](https://github.com/applied-tape-mechanics/bff-interpreter) at runtime from pinned GitHub releases via jsDelivr CDN (`@v1.0.0`).
  - Supports **OS 9** and **OS X** themes, includes a live hex memory tape visualizer, and runs 100% standalone in the browser via the JavaScript Brainfuck VM when hosted on GitHub Pages (`DISABLE_BACKEND=true`).

---

## 🧠 Brainfuck Tape Memory Layout

See [`bf/README.md`](bf/README.md) for the hashing trace.

| Cells | Region | Description |
| :---: | :--- | :--- |
| `0 - 255` | Working Area | Scratchpad (`256` cells) used during `hash.bf` execution (snapshotted & restored on every hash) |
| `256 - 65535` | Storage Area | 256 open-addressed buckets × 255 cells each (`65,280` cells; `256 + 65,280 = 65,536` exact cells) |

### Bucket Structure (`255` cells per bucket at `256 + bucket_index * 255`)
| Offset | Size | Field | Description |
| :---: | :---: | :--- | :--- |
| `+0` | `1` | `flag` | Bucket state: `0` = Empty, `1` = Occupied, `2` = Tombstone (deleted) |
| `+1..+64` | `64` | `key` | Null-terminated UTF-8 key string (up to `63` bytes) |
| `+65..+254` | `190` | `value` | Null-terminated UTF-8 value string (up to `189` bytes) |

---

## 🐳 Docker Setup (Zero Host Dependencies)

A pre-built production image is published automatically to **GitHub Container Registry (`ghcr.io`)**:

```bash
# Run the microservice directly from GHCR on http://localhost:8008
docker run --rm -p 8008:8000 ghcr.io/applied-tape-mechanics/bff-key-value-database:latest
```

### Using Docker Compose (Development, Testing & Production)

```bash
# Run the full 33-test suite (BF hash, CRUD, collision probing, tombstones & HTTP API) inside Docker
docker compose run --rm test

# Run TypeScript type checking inside Docker
docker compose run --rm test npm run typecheck

# Pull and start pre-built release images (service + Brainfuck healthcheck sidecar) from GHCR
docker compose pull
docker compose up -d

# Or build locally from source and start in the background
docker compose up -d --build
```

Visit:
- **Interactive Web UI & Tape Inspector:** [http://localhost:8008](http://localhost:8008) (or [http://localhost:8008/ui](http://localhost:8008/ui))
- **Swagger OpenAPI Docs:** [http://localhost:8008/docs](http://localhost:8008/docs)
- **Brainfuck Healthcheck Sidecar:** [http://localhost:8084](http://localhost:8084)

---

## 💻 Local Development (Node.js ≥ 22.18)

```bash
npm install
npm run dev          # watch mode on http://localhost:8000
npm test             # node:test (33 unit & integration tests)
npm run typecheck    # tsc --noEmit
```

---

## 📡 API Examples

### 1. Set a Key-Value Pair (`PUT /db`)
```bash
curl -X PUT http://localhost:8008/db \
  -H "Content-Type: application/json" \
  -d '{"key": "user:1001", "value": "Alice Cooper"}'
```

### 2. Retrieve a Key (`GET /db/{key}`)
```bash
curl http://localhost:8008/db/user:1001
```
```json
{
  "key": "user:1001",
  "value": "Alice Cooper"
}
```

### 3. List All Entries & Inspect Stats (`GET /db` & `GET /stats`)
```bash
curl http://localhost:8008/db
curl http://localhost:8008/stats
```

### 4. Dump Raw Brainfuck Memory Tape (`GET /tape`)
```bash
curl "http://localhost:8008/tape?start=256&length=64"
```

### 5. Delete a Key (`DELETE /db/{key}`)
```bash
curl -X DELETE http://localhost:8008/db/user:1001
```

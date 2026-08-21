# Contributing to AI-CMS

Thanks for contributing! This document explains how to develop and submit changes.

## Before You Start

1. Search [Issues](https://github.com/holyxing/ai-cms/issues) / Discussions to avoid duplicates.
2. For large features, open an Issue first so we can align on scope.
3. Never commit secrets (`.env`, API keys, tokens). See [SECURITY.md](./SECURITY.md).

## Development Setup

### Requirements

- Docker 24+ / Compose v2+
- 4GB+ RAM, ports `80`, `18888`, `18889`, `5432`, `9000` free (or adjust in `deploy/.env`)

### Bootstrap

```bash
git clone https://github.com/holyxing/ai-cms.git
cd ai-cms
cp deploy/.env.example deploy/.env
# Optional: fill AI keys in deploy/.env — leave blank to skip live LLM calls
./scripts/start.sh
docker compose -f deploy/docker-compose.yml exec api alembic upgrade head
```

Admin UI: `http://localhost/admin`  
API docs (dev): `http://localhost:18888/docs`

Default seed (optional):

```bash
docker compose -f deploy/docker-compose.yml exec api python3 scripts/seed_demo.py --reset
```

Demo password is documented in the seed script output. **Change it for any shared environment.**

### Frontend / Backend (optional hot paths)

- Frontend: `frontend/` — Vite + React + TypeScript  
- Backend: `backend/` — FastAPI + uv  
- Design rules: `docs/06-设计系统.md` and `AGENTS.md` (required for UI PRs)

## Pull Requests

1. Branch from `main`: `feat/...`, `fix/...`, or `docs/...`
2. Keep diffs focused; do not reformat unrelated files
3. Update docs when behavior changes
4. Ensure containers still start (`./scripts/start.sh`)
5. Fill the PR template

### Commit Messages

Prefer short imperative summaries, e.g.:

- `feat: add notification badge count`
- `fix: prevent CORS on HTML import`
- `docs: open-source README and SECURITY`

## Code of Conduct

By participating, you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).

## License

Contributions are licensed under [Apache License 2.0](./LICENSE).

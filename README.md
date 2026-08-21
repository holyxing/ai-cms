# AI-CMS

**AI-assisted multi-site CMS with static publishing (SSG).**

Build content with an AI writing assistant and a block/HTML editor, manage multiple sites in one admin, and publish to Astro static sites for CDN-friendly delivery.

[中文说明](./README.zh-CN.md) · [Contributing](./CONTRIBUTING.md) · [Security](./SECURITY.md) · [License](./LICENSE)

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Stack](https://img.shields.io/badge/stack-FastAPI%20%7C%20React%20%7C%20Astro-0f172a)](#tech-stack)

---

## Why AI-CMS?

| Pain | AI-CMS |
| --- | --- |
| Classic CMS is heavy to operate | Docker Compose, static output, simple ops |
| Headless CMS still needs a front-end team | Built-in layouts + Astro SSG |
| Writing & SEO are slow | AI assist (draft / rewrite / polish) in the admin |
| Multi-brand sites = many backends | One admin, many sites |

> Not a hosted SaaS clone — **self-hosted**, open source, your data & your API keys stay with you.

---

## Features

- **Multi-site admin** — sites, categories, contents, media, layouts
- **AI assistant** — pluggable providers (OpenAI-compatible, Anthropic, MiniMax, Ollama…)
- **Editor** — HTML / rich text workflows + AI enhance tools
- **Static publish** — site / category / article scoped builds
- **Notifications** — publish success/failure with duration in the bell center
- **RBAC** — roles, members, recycle bin

---

## Quick start

### Requirements

- Docker 24+ / Compose v2+
- ~4GB RAM, ~10GB disk
- Free ports: `80` (nginx), `18888` (API), `18889` (admin), `5432`, `9000` (or change in env)

### 1. Clone & configure

```bash
git clone https://github.com/holyxing/ai-cms.git
cd ai-cms
cp deploy/.env.example deploy/.env
```

**Secrets:** leave `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `MINIMAX_API_KEY` empty unless you need live LLM calls.  
**Never commit** `deploy/.env` or any real API keys. See [SECURITY.md](./SECURITY.md).

### 2. Start

```bash
./scripts/start.sh
# equivalent:
# docker compose -f deploy/docker-compose.yml up -d
```

### 3. Migrate DB (first run)

```bash
docker compose -f deploy/docker-compose.yml exec api alembic upgrade head
```

### 4. Optional demo seed

```bash
docker compose -f deploy/docker-compose.yml exec api python3 scripts/seed_demo.py --reset
```

Use the accounts printed by the seed script. **Change passwords on any shared host.**

### 5. Open

| URL | Purpose |
| --- | --- |
| http://localhost/admin | Admin UI (via nginx) |
| http://localhost:18888/docs | OpenAPI (dev) |
| http://localhost:9001 | MinIO console (local) |

Stop: `./scripts/stop.sh`  
Tear down containers (keep volumes): `./scripts/stop.sh --down`

---

## Tech stack

- **Backend:** FastAPI, PostgreSQL, Redis, Celery, MinIO
- **Admin:** Vite, React, TypeScript, Tiptap-oriented editing
- **Publish:** Astro / layout renderer → static files under site public dir
- **Deploy:** Docker Compose + nginx

---

## Documentation

| Doc | Content |
| --- | --- |
| [Product](./docs/00-产品设计.md) | Positioning & architecture |
| [API](./docs/02-API-规范.md) | REST + auth |
| [AI agents](./docs/03-AI-Agent-设计.md) | Task design |
| [Design system](./docs/06-设计系统.md) | UI rules (required for UI PRs) |
| [Ops guide](./docs/22-部署运维指南.md) | Production deploy / HTTPS / backup |
| [User handbook](./docs/23-用户使用手册.md) | Creator workflows |

Agent notes for coding assistants: [AGENTS.md](./AGENTS.md)

---

## Screenshots

Add images under `docs/images/` (see that folder’s README), then link them here:

<!--
![Login](./docs/images/login.png)
![Editor](./docs/images/editor.png)
![Publish](./docs/images/publish.png)
-->

---

## Roadmap (high level)

- Hardening for public self-host installs
- Richer template gallery
- Better onboarding & English UI coverage
- Optional cloud object storage guides

Track progress in [Issues](https://github.com/holyxing/ai-cms/issues).

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and the [Code of Conduct](./CODE_OF_CONDUCT.md).

Security reports: [SECURITY.md](./SECURITY.md) — **do not** post API keys in issues.

---

## License

Copyright 2026 AI-CMS contributors.  
Licensed under the [Apache License 2.0](./LICENSE).

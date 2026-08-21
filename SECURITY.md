# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| `main` (latest) | ✅ |
| Tagged releases `v0.x` | ✅ best-effort |

## Reporting a Vulnerability

**Do not open a public GitHub Issue for security vulnerabilities.**

Please report privately:

1. Email the maintainers (preferred): open a GitHub **Security Advisory** on this repository:  
   `https://github.com/holyxing/ai-cms/security/advisories/new`
2. Or contact the repository owner via GitHub.

Include:

- Affected version / commit
- Reproduction steps
- Impact assessment (data leak, RCE, auth bypass, etc.)
- Whether you plan to disclose publicly and on what timeline

We aim to acknowledge reports within **72 hours** and provide a fix or mitigation timeline after triage.

## Secrets & API Keys

- **Never commit** `.env`, API keys, JWT tokens, Fernet keys, or cloud credentials.
- Copy `deploy/.env.example` → `deploy/.env` and fill secrets locally.
- AI provider keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `MINIMAX_API_KEY`, …) must stay in environment / encrypted DB fields only.
- If you accidentally commit a secret: **rotate it immediately**, then contact maintainers to scrub git history.

## Safe Defaults for Production

- Change `SECRET_KEY`, `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`, and all demo passwords.
- Set a strong `FERNET_KEY` (encrypts stored AI API keys at rest).
- Disable default demo accounts or rotate their passwords after seed.
- Put the stack behind HTTPS (see `docs/22-部署运维指南.md`).

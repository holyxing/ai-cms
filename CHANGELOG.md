# Changelog

## [0.1.0] — 2026-08-21

### Added

- Open-source packaging: Apache-2.0 license, SECURITY, CONTRIBUTING, Code of Conduct
- GitHub Issue / PR templates and basic CI workflow
- English + Chinese README for public onboarding
- Notification center for static publish results (success/failure, duration)
- Import HTML from file or URL; content workspace header parity (bell + theme)

### Security

- Documented secret handling; `.env` / tokens / API keys must never be committed
- Removed local JWT artifact from the repository tree before public release

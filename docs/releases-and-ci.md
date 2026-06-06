# Releases and CI

## Image

Published to **`ghcr.io/delabrcd/ngrid-dashboard`** by GitHub Actions
(`.github/workflows/docker-publish.yml`), built from the multi-stage `app/Dockerfile` on the
Playwright base image.

## Tags

| Tag | Points at |
|---|---|
| `latest` | the newest **non-prerelease release** (what compose pulls by default) |
| `X.Y.Z`, `X.Y`, `X` | a specific release |
| `edge` | the current `main` branch |
| `sha-xxxxxxx` | the exact commit of any build |

Guarantees, enforced explicitly in the workflow:
- `:latest` moves **only** on a published, non-prerelease release
  (`type=raw,value=latest,enable=${{ github.event_name == 'release' && !github.event.release.prerelease }}`, with `flavor: latest=false`).
- **`main` builds publish `:edge` + `:sha-…` and never touch `:latest`.**

## Cutting a release (release-driven)

Publishing a **GitHub Release** is the single action — it creates the tag *and* triggers the
build. The workflow triggers on `release: published` (not bare tag pushes, so there's exactly
one build per release).

```bash
gh release create v0.1.2 --generate-notes
# or: GitHub UI → Releases → Draft a new release → choose a new tag vX.Y.Z → Publish
```

CI then publishes `0.1.2`/`0.1`/`0` and moves `:latest`.

## Versioning (no manual bump)

The version is **derived from the release tag** — don't edit `package.json` (its `version` is a
`0.0.0` placeholder). CI resolves `APP_VERSION` (release → `X.Y.Z`; otherwise
`0.0.0-edge.<sha>`), passes it as a Docker build-arg, and the build:
- writes it into `package.json` (`npm pkg set version`), and
- inlines it as `NEXT_PUBLIC_APP_VERSION` — shown in the dashboard footer.

## Deploy storage notes

The standalone `docker-compose.yml` uses Docker named volumes for Postgres (`pgdata`) and the
session (`session`), and a host bind for PDFs (`PDF_DIR`). A separate server overlay (behind a
reverse proxy + SSO) is **not** part of this repo.

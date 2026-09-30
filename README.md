# SelfCloud

A self-hosted personal drive and family photo library. JavaScript + Express,
React, SQLite, and Docker Compose, with explicit `model/`, `vue/`, and
`controller/` directories.

## Development

Requires Node.js 24+. Run `npm install`, configure the environment using
`.env.example`, then `npm run dev`. Node does not automatically load `.env`;
use `node --env-file=.env server.js` when starting the backend manually.

The browser development server runs on port 5173 and proxies `/api` to port 3000.
`npm run build` builds the frontend; `npm start` serves the production application.

See [architecture](docs/architecture.md) for ownership and directory conventions.

## Install on your server

Follow [the Docker Compose installation guide](docs/installation.md). The web
setup wizard creates the administrator and configures quotas and upload limits.

## Features

- Private multi-user drives, folders, batch and directory uploads.
- Photo timelines, original downloads, versioned metadata, HEIC conversion in Docker.
- Family groups sharing personal photos without duplicating originals.
- Quotas, configurable trash retention, and administrator-managed accounts.
- English/French interface, responsive layouts, light/dark mode, original SVG logo.
- [Offline backup and restore](docs/backups.md) with integrity verification.
- [Beginner remote HTTPS guide](docs/remote-access.md), including Cloudflare.

Run `npm test` for integration tests and `npm run build` for the production UI.
Automatic phone backup, named albums, public links, resumable uploads, and
two-factor authentication are future features. RAW previews are best-effort.

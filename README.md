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

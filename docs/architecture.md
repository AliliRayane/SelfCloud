# Architecture

SelfCloud uses JavaScript MVC: `model/` owns SQLite persistence and migrations,
`controller/` handles HTTP requests and authorization, and `vue/` contains React.
`service/` owns storage and background photo processing; `middleware/` provides
session authentication, same-origin protection, and error handling.

SQLite stores metadata; originals are immutable files with generated storage names.
Every original belongs to one user. Group shares reference originals without copies.
Administrators manage accounts and group content, but cannot browse private originals.
Trash hides shared files and counts toward quotas. Restoration restores remaining shares.
Removing a member removes their shares in that group. Preview and metadata routes use
the same authorization as downloads. All metadata stays attached to the original.

Photo processing is asynchronous and persisted in SQLite. Extracted metadata is
versioned JSON, and originals can be reprocessed for future features. Unsupported
formats remain downloadable. Capture dates use available EXIF dates, otherwise upload time.

Deployment targets a single home Linux server with a persistent `/data` volume.
First-run setup is protected by a one-time operator-supplied token. Quotas, maximum
upload size, language and trash retention are installation settings.

Commit prefixes: `feat:` for features, `fix:` for corrections, `dev:` for tooling/docs.

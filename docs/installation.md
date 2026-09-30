# Installation on a home Linux server

## 1. Prepare Docker

Install Docker Engine and its Compose plugin for your Linux distribution. Verify:

```sh
docker --version
docker compose version
```

Run the following commands from the SelfCloud repository.

## 2. Configure SelfCloud

```sh
cp .env.example .env
openssl rand -hex 32
```

Paste the generated value into `SETUP_TOKEN` in `.env`. Keep it private; it lets
you create the first administrator. Choose the exact URL you will use in your
browser, for example `PUBLIC_ORIGIN=http://192.168.1.50:3000`. Use a stable LAN IP.
Leave `SECURE_COOKIES=false` and `TRUST_PROXY=0` for local HTTP access.

Prepare the backup mount for the container's unprivileged user (UID 1000):

```sh
mkdir -p backups
sudo chown 1000:1000 backups
docker compose up -d --build
```

Docker creates `selfcloud-data`, a persistent volume containing SQLite,
originals, previews, and temporary uploads. To use a dedicated disk instead,
replace `selfcloud-data:/data` in Compose with `/your/disk/selfcloud:/data`, create
that directory, and give UID 1000 ownership before starting. Prefer a local
filesystem; SQLite WAL should not be placed on network filesystems.

## 3. First-run wizard

Open your configured URL. Enter the setup token, administrator credentials,
default quota in GB, maximum upload size in MB, trash retention, and language.
Passwords require at least 12 characters and at most 72 UTF-8 bytes.

Sign in, create users in Administration, then create groups and select their
members. Include your administrator in a group if you want to browse it normally.
Users can share photos from the photo viewer. Other group members cannot alter
their originals. Administrator moderation can remove group shares.

## Operations

```sh
docker compose logs -f selfcloud
docker compose stop selfcloud
docker compose up -d --build
```

One app instance must own a data directory. Do not run multiple containers on
the same SQLite/files volume. Do not use `docker compose down -v` unless you
intend to destroy stored data. Follow [backup instructions](backups.md) before
updating. See [remote access](remote-access.md) before publishing the service.

## Photo compatibility

The container includes `heif-convert` for HEIC/HEIF phone images. JPEG, PNG,
WebP and other sharp-supported images get previews. RAW preview support is
best-effort and depends on embedded/codec support. Originals are always retained
and downloadable. Verify your particular iPhone/Android HEIC files before
importing a large library. Live Photo video pairing and automatic phone backup
are not implemented; mobile browsers support manual uploads.

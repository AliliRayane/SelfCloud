# Verification status

The initial implementation passes `npm test` (13 checks including the parent
workflow), `npm run build`, and `npm audit` (zero reported vulnerabilities at
implementation time).

Integration coverage includes setup-token enforcement, closed initialization,
administrator-only account management, cross-origin rejection, private-file
isolation including administrator access, exact original preservation, folder
paths and cycle prevention, EXIF capture dates, generated WebP previews, group
membership and moderation, trash restoration, quotas, unsupported photo formats,
retention cleanup, disabled accounts, credential/session revocation, backup
restoration, and corrupt-backup rejection.

Docker was unavailable in the implementation environment. The Docker image and
Compose deployment have not been executed locally. The GitHub Actions workflow
builds the image, checks startup endpoints, and checks the bundled HEIC converter
when it runs on GitHub; those remote checks have not yet run here.

Remaining deployment verification:

1. Follow `installation.md` on a machine with Docker and complete the web wizard.
2. Try representative iPhone/Android HEIC images; the current automated photo
   fixture is JPEG with EXIF, not a real phone HEIC sample.
3. Exercise the React UI on desktop and mobile browsers. The production build
   passes, but browser-driven visual/end-to-end tests have not been run.
4. Test a backup restore into a fresh Docker volume.
5. After choosing remote hosting, test real uploads through that HTTPS path.

RAW preview support remains best-effort. The source original is retained when
decoding is unsupported. The current release uses one upload request per file;
network failures require retrying the file.

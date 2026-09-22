# InjOffice Desktop

InjOffice Desktop is a local Electron editor around the same native extract/apply
engines as the playground. It has no AI, no account, and no required hosted
backend. The renderer stays offline except the optional GitHub updater in
**signed public** builds.

The private workspace is `apps/desktop` (`@injoffice/desktop`, not published).
Host adapters, the mock-tested Electron main process, the start page, workspace
shell, OpenError, hidden-apply scheduler, and format helpers live there and
are tested in the `core` CI shard. **Electron is a desktop host dependency**;
renderer `/src/` stays offline (`check-office-architecture` allows the desktop
host to list it; the lockfile may contain it only when pulled by
`apps/desktop`. Renderer `/src/` still forbids `electron` imports).
Root `desktop:build`, `desktop:start`, and `desktop:dist` scripts forward to
`@injoffice/desktop`.

This is not Microsoft Office parity. Do not advertise it as such.

## Run from source

From the repository root:

```bash
npm ci
npm run desktop:build
npm run desktop:start
```

`npm run desktop:dist` packages unsigned installers into `apps/desktop/release/`.

Needs Node.js 22 or newer, the Go version declared in the native modules, and
Bash (Git Bash on Windows). The desktop build compiles the bundled WASM
engines (`@injoffice/docx-wasm`, `@injoffice/xlsx-wasm`, `@injoffice/pptx-wasm`
via the workspace `prebuild` script) and the Electron host. Vite fails the
renderer build when any engine `.wasm`, `wasm_exec.js`, or worker is missing
from those packages' `dist/`, or when the bundle has no hashed copy of them;
`INJOFFICE_ALLOW_STUBS=1` downgrades that to a warning for local UI work only
and must never be set for a packaged build. It does **not** start `injoffice-server` and it
does **not** use the playground on port 3100.

Create or open `.docx`, `.xlsx`, `.pptx`, or `.pdf`. Unsupported mutations
refuse and leave prior bytes. Binary Word 97–2003 (`.doc`), PowerPoint 97–2003
(`.ppt`), Excel `.xlsb`, OpenDocument `.ods`, and encrypted compound-file
`.docx` fail closed on extract. Macro-enabled `.docm` is zip OOXML and can
paint; VBA is not executed.

## Engine lockstep

Desktop WASM must track current `main`. After an engine merge, rebuild desktop
from that SHA. Do not freeze a lagging snapshot as the advertised product.
Unsigned developer previews are not public updates.

## Builds and updates

Installer output belongs in `apps/desktop/release/` and is gitignored. Do not
commit DMGs, NSIS installers, AppImages, or `latest-*.yml`.

Packaging icons live in `apps/desktop/build/icons/`: `icon.png` (1024 × 1024,
window icon), `icon.icns` (macOS and the source of the Linux icon size set), and
`icon.ico` (Windows). They are nearest-neighbor
conversions of repository-root `logo.png`. Regenerate on macOS with
`python3 apps/desktop/build/icons/generate.py`.

### Unsigned developer previews

GitHub Actions → **Desktop builds** (`.github/workflows/desktop.yml`,
`workflow_dispatch` only). Matrix:

| Platform | Artifact |
| --- | --- |
| mac-arm64 | DMG + ZIP |
| mac-x64 | DMG + ZIP |
| win-x64 | NSIS |
| linux-x64 | AppImage, DEB, RPM |
| linux-arm64 | AppImage, DEB, RPM |

These artifacts are unsigned. They must not set `injofficeRelease`.
`CSC_IDENTITY_AUTO_DISCOVERY` is false. Update checks are enabled by default in
every packaged build. Previews discover published `desktop-preview-vX.Y.Z[-rN]`
and stable `desktop-vX.Y.Z` releases; signed builds only discover stable releases.
Only greater application versions are offered, so rebuilding 0.1.0 does not
update an existing 0.1.0 installation. Install the corrected preview once to
enable checks in copies that shipped with the old updater disabled.

On macOS, preview packaging uses an **ad-hoc signature** to seal the complete app
bundle. This is not Developer ID signing or notarization: Gatekeeper can still
block a downloaded preview. The workflow verifies the signature and starts the
packaged Electron executable in Node mode before uploading installers. These
checks do not replace interactive install/open/edit/save testing.

### Signed public drafts

Tag a commit `desktop-v*` (desktop versions are independent of npm package
versions) or dispatch **Desktop release draft**
(`.github/workflows/desktop-release.yml`) against that tag. The workflow uses
the `desktop-release` GitHub environment and creates a **draft** GitHub
Release. It never publishes. Ordinary CI artifacts and local `electron-builder`
output do not become public updates.

Required environment secrets (not supplied by this repository):

| Secret | Purpose |
| --- | --- |
| `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` | Developer ID Application P12 |
| `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | Notarization |
| `WINDOWS_CSC_LINK` / `WINDOWS_CSC_KEY_PASSWORD` | Authenticode PFX |

Publish a draft only after install, open/edit/save, and upgrade checks on each
shipped platform. If a release is broken, ship a higher patch version; do not
replace published bytes.

Windows, AppImage, DEB and RPM use `electron-updater` for download and restart, including
preview builds. Signed Mac builds also use that native updater. Ad-hoc signed Mac
previews instead offer the matching DMG for installation by the user, because
native Mac updates require proper signing. Checks run after 15 seconds and every
six hours unless the user turns automatic checking off; manual checks remain
available. The renderer remains offline; update requests use a separate Electron
session. Downloads and restart are user-initiated. Restart must refuse unsaved
documents and failed recovery writes. Publish native `latest*.yml` feeds and
their referenced assets together, with filenames unchanged from the build.

DEB/RPM updates download inside InjOffice and verify the update feed's SHA-512
hash before offering Restart and update. Installation invokes the system package
manager with administrator authorization; canceling or failing installation keeps
the app open and the downloaded update available to retry. Package-manager
signature and dependency checks remain enabled. The installed `package-type`
marker selects DEB or RPM, while `APPIMAGE` selects AppImage; distribution guesses
are not used. There is no APT/YUM repository. The unsigned preview
matrix supports Linux ARM64; the signed-draft matrix currently supports Linux
x64 only. Windows ARM, beta channels, staged rollouts, and store distribution
are out of scope.

### Linux installation and app listings

Use the x64 DEB on Ubuntu or Debian running on Intel/AMD 64-bit hardware. Use the
ARM64 DEB on ARM Linux, including Ubuntu in Parallels on Apple Silicon. Run
`dpkg --print-architecture`: `amd64` needs x64, while `arm64` needs ARM64. RPM is
for RPM-based distributions, and AppImage is the portable alternative.

DEB and RPM packages include the InjOffice launcher, a set of icon resolutions,
and AppStream metadata naming Injecting Inc. with `https://injoffice.com` as the
homepage. CI extracts the actual installers to validate those files and fields.
The package `desktopName` matches the launcher so Linux desktops can associate
running windows with the installed icon.

These fields identify the app; they do not verify its publisher. A local DEB may
still be shown as an unknown publisher or potentially unsafe by Ubuntu Software
or App Center. Traditional DEB/RPM packages do not expose Flatpak-style sandbox
permission metadata, and this project currently has no trusted APT/YUM feed or
store listing. Do not advertise metadata changes as removing those warnings.

The **Ubuntu installer smoke** workflow runs automatically on build artifacts
after every successful **Desktop builds** packaging matrix. It also accepts a
published desktop release tag when run manually. On Ubuntu 22.04/24.04 x64 and
Ubuntu 24.04/26.04 ARM64 it verifies the DEB checksum and architecture, installs through
APT, launches the installed application under Xvfb with its sandbox enabled, and
creates a blank spreadsheet through the real renderer and native engine. It saves
startup logs and a screenshot for diagnosis. This checks installation/startup on
the CI images; it does not certify every Linux distribution, desktop, or GPU.
These desktop workflows are not ordinary PR checks or required merge checks.

For a downloaded DEB, Ubuntu App Center's local-package page does not load the
app icon or publisher and leaves the published date unset. Its PackageKit APT
backend can return an unknown license even when the DEB contains a License field.
Bundled icons and AppStream metadata therefore do not guarantee a complete
pre-installation listing. See the upstream [local-DEB UI](https://github.com/ubuntu/app-center/blob/main/packages/app_center/lib/apps/app_title_bar.dart),
[publisher UI](https://github.com/ubuntu/app-center/blob/main/packages/app_center/lib/widgets/app_title.dart),
[metadata model](https://github.com/ubuntu/app-center/blob/main/packages/app_center/lib/deb/local_deb_model.dart),
and [PackageKit backend](https://github.com/PackageKit/PackageKit/blob/main/backends/apt/apt-job.cpp).

## Tests and CI

Desktop **host** tests (Node, no GUI) belong in the `core` shard of
`scripts/ci-test-shards.json` once the workspace has a `test` script. Native
WASM editor tests, packaging, and signed builds are **not** PR merge gates.

```bash
npm run test -w @injoffice/desktop
npm run typecheck -w @injoffice/desktop
# after desktop:build; no GUI: drives each built engine worker + wasm_exec.js + .wasm
npm run test:native -w @injoffice/desktop
# after electron-builder; no GUI: app.asar carries host, renderer and byte-identical engines
npm run test:packaged -w @injoffice/desktop
node apps/desktop/scripts/check-packaged-updater.cjs apps/desktop/release   # --release for signed drafts
npm run manifest -w @injoffice/desktop   # release/manifest.json + SHA256SUMS with the source revision
```

`scripts/release-validation.mjs preflight <mac|windows|linux>` refuses a signed
release run that is not on a matching `desktop-vX.Y.Z` tag or lacks a signing
secret for the platform; `collect <dir>` checks the downloaded asset set.

Electron, TipTap, Univer, and HTML/SVG preview are not the OOXML file
authority. `scripts/check-office-architecture.mjs` must keep forbidding
Electron as native authority.

## Support limits

- No claim of Word/Excel/PowerPoint/Acrobat feature or layout parity.
- DOCX on-screen preview may use flowing HTML; page-paint is a separate export
  path and is the layout that should match a printed page.
- Updates come only from published desktop releases in `injectinglabs/injoffice`;
  signed builds exclude previews and all builds exclude npm releases and drafts.
- External Office oracles and private fidelity corpora stay local; do not add
  them to CI.

### Installed upgrade regression checks

Updater/packaging pull requests run the desktop build matrix and installed-upgrade
checks on Windows x64 and Ubuntu x64/ARM64, as does the manual desktop workflow.
The check makes a CI-only 0.0.0 baseline from the candidate artifact, retaining
its updater implementation, then drives the actual installed app through checking
the public GitHub feed, downloading, installing, and automatically relaunching
the latest published desktop release. The modified baseline is never published.
CI checks both the installed application version and a newly launched process.
An isolated CI polkit rule approves only apt-get; cancellation is covered by unit tests.
Mac's Squirrel update requires signed baseline and target builds, so this unsigned
CI check does not establish successful Mac installation. Sign and notarize both
versions and perform that upgrade check before claiming Mac update support.

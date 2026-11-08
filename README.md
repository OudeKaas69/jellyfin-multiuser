# Jellyfin for webOS — Multi-user fork

This repository is a multi-user fork of [`jellyfin/jellyfin-webos`](https://github.com/jellyfin/jellyfin-webos), tested on **LG OLED65G4 (webOS 10.3.1)**.

## What This Fork Adds

- **"Who's watching?" User Picker:** Displays public server users alongside locally saved user profiles — works even when all accounts are hidden from the login screen on the Jellyfin server (`/Users/Public` returns `[]`).
- **Add User & Quick Connect:** Add accounts via username/password or Jellyfin Quick Connect code directly from the TV.
- **Per-Profile 4-Digit PIN Lock:** Optional 4-digit PIN per profile with an on-screen TV remote keypad (D-pad + numeric buttons).
- **Profile Management:** Manage/remove PINs or remove saved profiles from the picker.
- **Fast User Switching:** Injects a **Switch User** icon into the Jellyfin top header bar and an entry in the user Settings menu to return to the profile picker without signing out or losing saved tokens.
- **TV Remote Sign-In UX:** Input fields only open the webOS on-screen keyboard when pressing **OK/Enter**, allowing smooth D-pad up/down traversal across inputs and buttons.

## How It Works

- The webOS wrapper hosts an overlay UI (`frontend/`) and loads the server's `jellyfin-web` interface inside a full-screen iframe.
- Saved profiles and access tokens for a server are persisted in the wrapper's `localStorage` under the key `jellyfin_auth_<serverId>`.
- When a profile is selected (and unlocked), the wrapper injects the selected user's credentials into the `jellyfin-web` iframe's `localStorage` (`jellyfin_credentials`) before navigating into the web UI.
- **PIN Security Note:** Profile PINs are stored locally in plain text inside `localStorage`. They are designed as a household UX convenience lock (e.g., preventing accidental profile switches or kids opening adult profiles) and are **not a cryptographic security boundary**.

## Building

```sh
npm install
npm run package
```

This outputs `build/org.jellyfin.webos_2.0.0_all.ipk` (and `npm run manifest` generates `build/org.jellyfin.webos.manifest.json`).

## Deploying to TV

### Rooted TV (via Telnet / SSH + Luna Bus)

1. Serve the `build/` directory from your workstation:
   ```sh
   python3 -m http.server 8765 --bind 192.168.1.122 --directory build
   ```
2. On the TV (via `telnet <tv-ip> 23` or SSH as `root`), download the IPK to `/tmp` and install via `appInstallService`:
   ```sh
   wget -O /tmp/x.ipk http://192.168.1.122:8765/org.jellyfin.webos_2.0.0_all.ipk
   luna-send -w 60000 -i luna://com.webos.appInstallService/dev/install '{"id":"com.ares.defaultName","ipkUrl":"/tmp/x.ipk","subscribe":true}'
   ```
3. Launch the app:
   ```sh
   luna-send -n 1 luna://com.webos.applicationManager/launch '{"id":"org.jellyfin.webos"}'
   ```

### LG Developer Mode TV (via `ares-cli`)

```sh
npx ares-install -d tv build/org.jellyfin.webos_2.0.0_all.ipk
npx ares-launch -d tv org.jellyfin.webos
```

## Upstream Sync

Upstream tracking is automated via Forgejo Actions (`.forgejo/workflows/upstream-check.yml` + `tools/upstream-check.sh`):

- **Tracked baseline:** `.upstream-sha` at the repository root stores the last merged commit SHA from `https://github.com/jellyfin/jellyfin-webos` (`master`).
- **Weekly check:** Runs every Monday at 08:00 UTC (and on `workflow_dispatch`). If upstream `master` moves ahead of `.upstream-sha`, the workflow opens or updates a Forgejo issue (`Upstream changes available: ...`) and sends a Telegram alert.
- **Workflow secrets:**
  - `FORGEJO_TOKEN` (optional; falls back to automatic `github.token`)
  - `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (optional; skips Telegram notification with a warning if unset)
- **Manual merge steps:**
  ```sh
  git remote add upstream https://github.com/jellyfin/jellyfin-webos.git
  git fetch upstream
  git merge upstream/master
  # Resolve conflicts if any, verify build with `npm run package`, then update .upstream-sha:
  git rev-parse upstream/master > .upstream-sha
  git add .upstream-sha
  ```

## Planned Homebrew Channel Publication

Publishing this fork as a standalone webOS Homebrew Channel package named **Jellyfin-Multiuser** (app ID `nl.timsas.jellyfin.multiuser`, allowing side-by-side installation with official `org.jellyfin.webos`) is tracked in [Issue #6](https://forgejo.timsas.nl/tsas/jellyfin-webos/issues/6).

---

# Jellyfin for webOS
This is a small wrapper around the web interface provided by the server (https://github.com/jellyfin/jellyfin-web) so most of the development happens there.


## Download

For all versions:
<p align="center">
<a href="https://us.lgappstv.com/main/tvapp/detail?appId=1030579"><img alt="Enjoy on LG Smart TV" src="https://repo.jellyfin.org/releases/other/lg-badge/LG_BADGE_greyborders_135x40.png"/></a>
<br/>
<em><strong>Note:</strong> If you previously installed the app via Homebrew or Developer mode, you must uninstall that before you can use the store version.</em>
</p>


## License
All Jellyfin webOS code is licensed under the MPL 2.0 license, some parts incorporate content licensed under the Apache 2.0 license. All images are taken from and licensed under the same license as https://github.com/jellyfin/jellyfin-ux.

---

## Development

The general development workflow looks like this:

- Prepare a build environment of your choice (see below)
- Compile an IPK either with the IDE or with ares-package
- Test the app on the emulator or ares-server or install it on your tv by following http://webostv.developer.lge.com/develop/app-test/

There are three ways to create the required build environment:

- Full WebOS SDK Installation
- Docker
- NPM ares-cli

### Full WebOS SDK Installation

- Install the WebOS SDK from http://webostv.developer.lge.com/sdk/installation/

### Docker

A prebuilt docker image is available that includes the build and deployment dependencies, see [Docker Hub](https://ghcr.io/oddstr13/docker-tizen-webos-sdk).

### Managing the ares-tools via npm

This requires `npm`, the Node.js package manager.

Execute the following to install the required WebOS toolkit for building & deployment:

`npm install`

Now you can package the app by running:

`npm run package`

## Building with Docker or WebOS SDK

`dev.sh` is a wrapper around the Docker commands. If you have installed the SDK directly, just omit that part.

```sh
# Build the package via Docker
./dev.sh ares-package --no-minify services frontend
# Build the package with natively installed WebOS SDK
ares-package --no-minify services frontend
```

## Usage
Fill in your hostname, port, and schema and click connect. The app will check for a server by grabbing the manifest and the public serverinfo.
Afterwards, the app hands off control to the hosted webUI.


## Testing
Testing on a TV requires [registering a LG developer account](https://webostv.developer.lge.com/develop/app-test/preparing-account/) and [setting up the devmode app](https://webostv.developer.lge.com/develop/app-test/using-devmode-app/).

Once you have installed the devmode app on your target TV and logged in with your LG developer account, you need to turn on the `Dev Mode Status` and `Key Server`.
**Make sure** to take a note of the passphrase.

```sh
# Add your TV. The defaults are fine, but I recommend naming it `tv`.
./dev.sh ares-setup-device --search

# This command sets up the SSH key for the device `tv` (Key Server must be running)
./dev.sh ares-novacom --device tv --getkey

# Run this command to verify that things are working.
./dev.sh ares-device-info -d tv

# This command installs the app. Remember to build it first.
./dev.sh ares-install -d tv org.jellyfin.webos_*.ipk

# Launch the app and the web developer console.
./dev.sh ares-inspect -d tv org.jellyfin.webos

# Or just launch the app.
./dev.sh ares-launch -d tv org.jellyfin.webos
```

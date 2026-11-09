# Upstream Diff & Architecture Walkthrough (`Jellyfin-Multiuser` / `nl.timsas.jellyfin.multiuser`)

This document provides a complete architectural overview and file-by-file, function-by-function code walkthrough of all changes made in **`Jellyfin-Multiuser`** (`nl.timsas.jellyfin.multiuser` v1.0.0) relative to upstream [`jellyfin/jellyfin-webos`](https://github.com/jellyfin/jellyfin-webos) at commit [`ab4794046467cdb88212ccc29212300cf9112a43`](https://github.com/jellyfin/jellyfin-webos/commit/ab4794046467cdb88212ccc29212300cf9112a43).

For the exact line-by-line unified diff against upstream, see [`docs/upstream-diff.patch`](upstream-diff.patch).

---

## 1. Overview: What `Jellyfin-Multiuser` Adds on Top of Upstream

Upstream `jellyfin-webos` is a lightweight webOS wrapper application that discovers or connects to a Jellyfin server (`frontend/index.html` + `frontend/js/index.js`), fetches `/System/Info/Public` and `/web/manifest.json`, and immediately hands off control (`handoff()`) to the server-hosted `jellyfin-web` interface inside a full-screen `<iframe id="contentFrame">`.

While simple, upstream's direct handoff has several limitations on shared household TVs:
1. **Single active session in `jellyfin-web`:** `jellyfin-web` stores a single active `UserId` and `AccessToken` per server in `localStorage.getItem('jellyfin_credentials')`. Switching between household members requires signing out (which revokes the token on the server) and re-entering credentials or Quick Connect codes every time.
2. **Hidden accounts (`IsHiddenRemotely` / hide from login screen):** When a Jellyfin administrator hides user accounts from the login screen (`/Users/Public` returns `[]`), `jellyfin-web` never displays user avatars on the login page.
3. **No profile-level PIN lock:** Shared living-room TVs have no quick 4-digit PIN lock to keep kids from opening adult profiles or accidentally switching accounts while keeping long-lived Jellyfin tokens saved locally.
4. **Side-by-side coexistence:** By renaming the package ID to `nl.timsas.jellyfin.multiuser` and the Luna discovery service to `nl.timsas.jellyfin.multiuser.service`, users can install `Jellyfin-Multiuser` from the webOS Homebrew Channel alongside the official LG Content Store or Homebrew `org.jellyfin.webos` app without conflict.

### High-Level Architecture

```
+-----------------------------------------------------------------------------------+
| webOS Wrapper Document (frontend/index.html)                                      |
|                                                                                   |
|  1. Server Connection & Discovery (frontend/js/index.js)                          |
|     - Connects to server -> fetches /System/Info/Public & /web/manifest.json      |
|     - Calls startProfileSelection(serverInfo, { allowAutoSignIn: true })          |
|                                                                                   |
|  2. Multi-User Profile Overlay Engine (frontend/js/profiles.js + profiles.css)    |
|     - Reads wrapper localStorage (`jellyfin_auth_<serverId>`)                     |
|     - Merges /Users/Public with locally saved profiles (supports hidden users)    |
|     - Renders "Who's watching?" grid + attached action drawer under selected card |
|     - Handles Add User (Manual Login / Quick Connect) & 4-digit Numeric PIN pad   |
|     - Invokes callback(authenticatedUser, authToken) when unlocked                |
|                                                                                   |
|  3. Iframe Credential Sync & Switch-User Injection (frontend/js/index.js)         |
|     - handoff(hosturl, bundle) loads jellyfin-web in <iframe id="contentFrame">   |
|     - Early script (`getCredentialClearScript`) + load script                     |
|       (`getCredentialInjectionScript`) synchronize `jellyfin_credentials` in      |
|       iframe localStorage with at most one sessionStorage-guarded reload          |
|     - Persistent UI script (`getSwitchUserInjectionScript`) injects "Switch user" |
|       buttons into `.headerRight` and `#myPreferencesMenuPage` and intercepts     |
|       `.btnLogout` ("Sign out") to `window.parent.postMessage({type:'showProfiles'})` |
+-----------------------------------------------------------------------------------+
```

---

## 2. Summary of Modified and Added Files Since `ab47940464`

| File | Status | Purpose |
| :--- | :--- | :--- |
| `package.json` | Modified | Updates package name to `nl.timsas.jellyfin.multiuser` (`1.0.0`), updates `deploy`, `launch`, `manifest`, and `test` scripts. |
| `frontend/appinfo.json` | Modified | Sets webOS app ID (`nl.timsas.jellyfin.multiuser`), title (`Jellyfin-Multiuser`), version (`1.0.0`), and vendor metadata. |
| `services/package.json` | Modified | Renames background discovery service package to `nl.timsas.jellyfin.multiuser.service` (webOS requires service IDs to be prefixed with the app ID). |
| `services/services.json` | Modified | Declares Luna bus service `nl.timsas.jellyfin.multiuser.service`. |
| `frontend/index.html` | Modified | Loads `css/profiles.css` and `js/profiles.js`; adds overlay containers (`#profileSelection`, `#numericPinOverlay`, `#pinOverlay`, `#manualLoginOverlay`, `#quickConnectOverlay`) as siblings outside `#contentFrame`. |
| `frontend/js/profiles.js` | Added | Strict ES5 multi-user profile management, authentication, Quick Connect polling, 4-digit PIN lock keypad, and 2D TV remote D-pad navigation engine. |
| `frontend/js/index.js` | Modified | Integrates `profiles.init()` into `handleSuccessManifest()`, implements early/load iframe credential synchronization, injects Switch User UI into `jellyfin-web`, handles `showProfiles`/`selectServer` `postMessage` events, and routes Back button (`keyCode 461`) across overlays. |
| `frontend/css/profiles.css` | Added | TV-optimized 10-foot UI styling for profile cards, unified selected-card action drawer, modal overlays, and 3x4 numeric PIN keypad. |
| `frontend/assets/icon-80.png` | Modified | 80x80 webOS app icon with high-contrast cyan/dark multi-user badge. |
| `frontend/assets/icon-130.png` | Modified | 130x130 webOS large app icon with multi-user badge. |
| `frontend/assets/icon-160.png` | Added | 160x160 icon used as `iconUri` for the webOS Homebrew Channel catalog. |
| `tools/gen-manifest.js` | Modified | Generates `nl.timsas.jellyfin.multiuser.manifest.json` including `ipkSize` (`fs.statSync`), `sha256`, `iconUri`, and public GitHub `sourceUrl`. |
| `tools/verify-code.js` | Added | CI/local verifier checking JSON metadata alignment, LF line endings, forbidden `eval()`, and strict ES5 AST compatibility (`acorn --ecma5`) for both static files and dynamically generated iframe injection scripts. |
| `tools/upstream-check.sh` | Added | Compares `.upstream-sha` against `jellyfin/jellyfin-webos` `master` and creates/updates an issue + optional Telegram notification when upstream advances. |
| `.forgejo/workflows/build.yml` | Added | CI pipeline running `npm test`, building the `.ipk` and `.manifest.json`, attaching release assets, and mirroring `master`, tags, and releases to `OudeKaas69/jellyfin-multiuser` on GitHub. |
| `docs/nl.timsas.jellyfin.multiuser.yml` | Added | Ready-to-submit `webosbrew/apps-repo` package definition file. |

---

## 3. Detailed File-by-File & Function-by-Function Walkthrough

### 3.1 `frontend/index.html` — Overlay DOM Structure Outside `#contentFrame`

In upstream `frontend/index.html`, the body contains only:
- `<iframe id="contentFrame">` (hidden until handoff)
- `<div class="container">` (the server connection / discovery screen)

In `Jellyfin-Multiuser`, five overlay `<div>` trees are placed in `frontend/index.html` **outside** `<div class="container">` and **outside** `<iframe id="contentFrame">`:
1. `#profileSelection` (`.profile-overlay`): The main "Who's watching?" screen containing `#profileServerName`, `#profileGrid` (populated dynamically by `profiles.renderProfiles()`), and `#switchServerBtn`.
2. `#numericPinOverlay` (`.pin-overlay`): The 4-digit PIN entry/setup modal with 4 visual indicator dots (`#pinDots`), error banner (`#numericPinError`), 3x4 on-screen numeric keypad (`#numericKeypad` with `data-digit="0..9"`, `#pinClearBtn`, `#pinBackspaceBtn`), and action buttons (`#numericPinForgot`, `#numericPinCancel`).
3. `#pinOverlay` (`.pin-overlay`): Secondary password prompt used when authenticating a public server account that already has a tile on the grid (`#pinInput`, `#pinSubmit`, `#pinQuickConnect`, `#pinCancel`).
4. `#manualLoginOverlay` (`.pin-overlay`): Full manual "Add User" dialog with `#manualUsername`, `#manualPassword`, `#manualLoginSubmit`, `#manualQuickConnect`, and `#manualLoginCancel`.
5. `#quickConnectOverlay` (`.pin-overlay`): Displays the 6-character Quick Connect code (`#quickConnectCode`) while polling the Jellyfin server (`#quickConnectCancel`).

**Why overlays live in the wrapper document outside `#contentFrame`:**
- When switching users from inside `jellyfin-web`, the wrapper hides `#contentFrame` (`contentFrame.style.display = 'none'; contentFrame.src = '';`) and shows `#profileSelection` immediately without destroying the wrapper's own `localStorage` (`jellyfin_auth_<serverId>`).
- Keeping overlays in the outer wrapper avoids CORS/CSP conflicts with the remote Jellyfin server and guarantees consistent TV remote key handling regardless of what page `jellyfin-web` was on.

---

### 3.2 `frontend/js/profiles.js` — Multi-User Profile Manager, Auth, PIN & 2D D-Pad Engine

#### Why Strict ES5 (`var`, `function`, no arrow functions/template literals)
Older LG webOS TVs (webOS 1.x–3.x use older WebKit/Chromium engines) fail to parse ES6+ syntax (`const`, `let`, arrow functions, template literals, destructuring, `Promise`). Even though primary hardware testing runs on webOS 10.3.1 (LG OLED65G4), `frontend/js/profiles.js` and `frontend/js/index.js` are written in 100% strict ES5 and verified via `acorn --ecma5` in `tools/verify-code.js` so the IPK remains compatible across all webOS versions supported by upstream.

#### State Properties (`profiles` singleton)
- `currentServer`: Current server metadata object (`{ id, Id, baseurl, hosturl, Name, Address }`).
- `users`: Array of public users returned by `GET /Users/Public`.
- `selectedUser`: Profile object currently being authenticated or configured.
- `selectedCardUserId`: User ID whose profile card currently has its attached action drawer expanded in `#profileGrid`.
- `onSuccessCallback`: Callback `function(user, token)` passed by `startProfileSelection` in `index.js`.
- `quickConnectSecret` / `quickConnectInterval`: Active Quick Connect session secret and 3-second polling timer ID.
- `pinAction`: Tracks the active mode of `#numericPinOverlay`: `'verify'` (unlock profile), `'setup'` (enter new 4-digit PIN), `'confirm'` (re-enter new 4-digit PIN), or `'verify_for_change'` (enter existing PIN before changing/removing).
- `tempPin` / `currentPinInput`: Holds the first PIN during setup confirmation and the current 0–4 digit buffer as the user presses digits.
- `forceShowSelection` / `allowAutoSignIn`: Flags controlling whether startup auto-sign-in is permitted (`allowAutoSignIn: true` on cold boot; `forceShowSelection: true` when clicking "Switch user").

#### Key Functions in `frontend/js/profiles.js`

- **`lockInput(input)` & `unlockInput(input)`:**
  - *Problem on webOS TVs:* Whenever a standard `<input>` receives `.focus()` via D-pad Up/Down navigation, webOS immediately pops up the full-screen virtual keyboard, hijacking remote navigation and preventing the user from moving down to the "Sign In" or "Cancel" buttons.
  - *Solution:* `lockInput` sets `input.readOnly = true` and `input.setAttribute('readonly', 'readonly')`. The user can D-pad focus across locked inputs freely without triggering the virtual keyboard. Only when the user presses **OK/Enter (`keyCode 13`)** on a focused input does `unlockInput(input)` clear `readOnly`, briefly blur/refocus the element (guarded by `input._jfUnlocking = true` so the `blur` listener does not re-lock it mid-refocus), and open the webOS virtual keyboard. When the user finishes typing and blurs the input, the `blur` listener calls `lockInput(input)` again.

- **`init(serverInfo, onSuccess, options)`:**
  - Normalizes `options` (`forceShowSelection`, `allowAutoSignIn`), resets `selectedCardUserId = null`, binds DOM event listeners once (`_listenersSetup`), and calls `fetchPublicUsers()`.

- **`getStorageKey()` / `getStoredAuth()` / `storeAuth(userId, userData)` / `removeStoredAuth(userId)`:**
  - Persists all saved profiles for a server in the wrapper's `localStorage` under `jellyfin_auth_<serverId>` (falling back to normalized `baseurl` before the server ID is resolved).
  - Each entry under `storedAuth[userId]` stores:
    - `token`: Long-lived Jellyfin `AccessToken`
    - `user`: `{ Id, Name, ServerId, PrimaryImageTag }`
    - `pin`: 4-digit string (or `null`)
    - `autoSignIn`: boolean (`true` for at most one user per server)
    - `timestamp`: Epoch ms when saved/updated

- **`migrateStorageIfNeeded(realServerId)`:**
  - If profiles were initially saved under a fallback URL key (`jellyfin_auth_http://...`) before `ServerId` was known, migrates and merges them into `jellyfin_auth_<realServerId>` as soon as authentication returns `user.ServerId`.

- **`setAutoSignIn(userId, enabled)` & `getAutoSignInUser()`:**
  - Enforces that enabling `autoSignIn` on one user clears `autoSignIn = false` on all other users for that server.

- **`getMergedUsers()`:**
  - *Why this is essential for hidden users:* Many Jellyfin admins set "Hide this user from login screens" on all accounts, causing `GET /Users/Public` to return `[]`.
  - `getMergedUsers()` starts with `this.users` (from `/Users/Public`), marks any user with a saved token in `getStoredAuth()` as `hasStoredAuth = true`, and then appends any locally saved users from `getStoredAuth()` that were **not** present in `/Users/Public` (marking them `isStoredOnly = true`).
  - As a result, once a hidden user signs in once via "Add User" or Quick Connect, their profile card and avatar appear permanently in "Who's watching?" on subsequent startups and user switches.

- **`fetchPublicUsers()`:**
  - Requests `GET <baseurl>/Users/Public`.
  - Checks if startup auto-sign-in should trigger:
    1. Only runs when `allowAutoSignIn && !forceShowSelection`.
    2. If a user has `autoSignIn: true` in `storedAuth`, calls `validateAndUseStoredAuth(userId, auth, true)`.
    3. Otherwise, if there is only a single known user (`mergedUsers.length === 1`) and that user has a stored token, auto-signs in via `validateAndUseStoredAuth`.
    4. Note: Inside `validateAndUseStoredAuth`, if that profile has a PIN (`stored.pin`), it still prompts for the 4-digit PIN (`showNumericPin(user, 'verify')`) before completing handoff.

- **`setAuthHeaders(xhr, token)`:**
  - Builds the MediaBrowser authorization string (`MediaBrowser Client="Jellyfin WebOS", Device="LG Smart TV", DeviceId="...", Version="..."`, plus `, Token="..."` when authenticated) and sets **both** `Authorization` and `X-Emby-Authorization` HTTP headers.
  - *Why both headers:* Jellyfin 10.12+ standardized on `Authorization` and deprecated `X-Emby-Authorization`, while older Jellyfin releases expect `X-Emby-Authorization`. Sending both ensures compatibility across all Jellyfin server versions.

- **`validateAndUseStoredAuth(userId, stored, isStartupAutoSignIn)`:**
  - Verifies the stored token is still valid on the server via `GET /Users/<userId>` with `setAuthHeaders(xhr, stored.token)`.
  - On HTTP 200: refreshes `stored.user` (e.g., updated `PrimaryImageTag` or `Name`). If `stored.pin` is set, opens `showNumericPin(stored.user, 'verify')`; otherwise calls `onSuccessCallback(stored.user, stored.token)`.
  - On HTTP 401/403/error: removes the expired token (`removeStoredAuth(userId)`) and falls back to `showProfileSelection()`.

- **`showProfileSelection()` & `renderProfiles()`:**
  - Hides `.container` and `#busy`, displays `#profileSelection` (`display: flex`), and renders `#profileGrid`.
  - Each profile is rendered inside a `<div class="profile-column" data-user-id="...">`:
    - A focusable `<button class="profile-card">` containing the user's avatar (`GET /Users/<Id>/Images/Primary?tag=<PrimaryImageTag>&quality=90&maxHeight=200` with fallback initial letter), name, and status badges (`PIN` lock badge if `stored.pin`, `Auto` badge if `stored.autoSignIn`, `Saved` badge if `stored.token`).
    - When `this.selectedCardUserId === user.Id` and `hasStoredAuth` is true, `profile-column` receives `.is-selected.has-actions` and renders an attached `<div class="profile-actions-drawer">` directly beneath the card with focusable `<button class="profile-action-btn">` items:
      1. **Sign In** (`is-primary`) -> `proceedSignIn(user)`
      2. **Auto Sign-in: ON / OFF** -> toggles `setAutoSignIn` and re-renders while preserving focus on the toggle button
      3. **Add PIN / Change PIN** -> opens `showNumericPin` (`'setup'` or `'verify_for_change'`)
      4. **Remove PIN** (when PIN exists) -> opens `showNumericPin(user, 'verify_for_change')` with `pendingPinRemoval = true`
      5. **Remove Profile** (`is-danger`) -> calls `removeStoredAuth(user.Id)`
  - Finally appends a `<div class="profile-column"><button class="profile-card add-user-card">` ("Add User") tile at the end of the grid.

- **`handleProfileClick(user)`:**
  - Clicking an already-saved user card toggles its attached action drawer (`selectedCardUserId`) and moves focus into the primary **Sign In** button inside the drawer (or back to the card when collapsing).
  - Clicking an unsaved public user card immediately calls `proceedSignIn(user)` (attempting passwordless login via `authenticateUser(user.Name, '')`, falling back to `showPinEntry(user)` if a password is required).

- **`showNumericPin(user, action)` & `handleNumericPinComplete(enteredPin)`:**
  - Drives all 4 PIN workflows (`'verify'`, `'setup'`, `'confirm'`, `'verify_for_change'`) using a 4-dot visual indicator and a 3x4 on-screen keypad.
  - Auto-submits 200ms after the 4th digit is entered (`currentPinInput.length === 4`).
  - Supports both D-pad navigation across the on-screen buttons and direct physical TV remote number buttons (`keyCode 48..57` and numpad `96..105`).
  - Includes a "Forgot PIN? Use Password" button (`#numericPinForgot`) during `'verify'` and `'verify_for_change'` so a user who forgets their local 4-digit PIN can re-authenticate against the Jellyfin server password or Quick Connect to reset it.

- **`finishLogin(user, token)`:**
  - Called after successful password or Quick Connect authentication:
    1. Checks `storedAuth` before saving to determine if this is a brand-new profile (`isNewProfile`) and whether a PIN already exists (`hasPin`).
    2. Saves `{ token, user }` via `storeAuth(user.Id, ...)`.
    3. If `mergedAfter.length <= 1` and `!hasPin` (single user on the server with no PIN): skips the extra "Set a 4-digit PIN?" prompt and signs straight into Jellyfin.
    4. If `mergedAfter.length > 1` and `!isNewProfile` (re-authenticating an existing user on a multi-user TV): returns to `showProfileSelection()` with that user selected.
    5. If `isNewProfile && !hasPin` on a multi-user setup: offers `showNumericPin(user, 'setup')` so the new user can optionally set a 4-digit PIN (or press "Skip (No PIN)").

- **Quick Connect (`startQuickConnect`, `pollQuickConnect`, `authenticateWithQuickConnect`):**
  - Calls `POST /QuickConnect/Initiate`, displays the 6-character `data.Code` in `#quickConnectOverlay`, polls `GET /QuickConnect/Connect?secret=...` every 3 seconds, and exchanges the authorized secret via `POST /Users/AuthenticateWithQuickConnect` into `finishLogin(data.User, data.AccessToken)`.

- **`setupNavigation()` — 2D Spatial D-Pad Navigation & Event Isolation:**
  - Attaches a `keydown` handler to `document`:
    - Guard: Only runs when one of the 5 profile/auth overlays is displayed (`display === 'flex'`).
    - Calls `e.stopPropagation()` on handled keys so `document.onkeydown` in `frontend/js/index.js` does not simultaneously trigger server-screen navigation.
    - **Inside `#profileSelection`:** Implements column-aware navigation across `.profile-column` elements:
      - **Left / Right (`37` / `39`):** Moves horizontally to the adjacent `.profile-column`'s `.profile-card`. If a different profile's action drawer was open, automatically collapses it so the user doesn't get trapped inside an old drawer.
      - **Down (`40`):** If the focused card has an expanded `.profile-actions-drawer`, steps into the first `.profile-action-btn`; from the last drawer button (or from a card with no drawer), steps down to `#switchServerBtn`.
      - **Up (`38`):** Steps up through the drawer buttons back to the parent `.profile-card`, or from `#switchServerBtn` back to the active profile column.
    - **Inside modal overlays (`#numericPinOverlay`, `#pinOverlay`, `#manualLoginOverlay`, `#quickConnectOverlay`):**
      - Computes the bounding box center `(cx, cy)` of every visible focusable control (`button, input`) inside the active overlay and selects the nearest control in the pressed direction (`left`, `right`, `up`, `down`) using weighted Euclidean distance (`primaryDist + secondaryDist * 2.5`). This allows natural 2D D-pad movement across the 3x4 numeric keypad and side-by-side modal buttons.

---

### 3.3 `frontend/js/index.js` — Handoff, Iframe Credential Sync & Switch-User UI

#### 1. `appInfo` & Luna Service Rename
- `appInfo.appName` is set to `'Jellyfin-Multiuser'`.
- `startDiscovery()` calls `webOS.service.request("luna://nl.timsas.jellyfin.multiuser.service", ...)` to match `services/package.json` and `services/services.json`.

#### 2. `backPressed()` & `document.onkeydown`
- `isAnyProfileOrOverlayDisplayed()` checks whether any of the 5 profile overlays are active.
- `document.onkeydown` suppresses server-connection arrow navigation when an overlay is displayed.
- `backPressed()` (`keyCode 461`) unwinds modals in priority order:
  1. `#numericPinOverlay` -> closes numeric PIN pad and returns to `showProfileSelection()`.
  2. `#quickConnectOverlay` -> cancels polling (`hideQuickConnect()`).
  3. `#pinOverlay` -> closes password prompt (`hidePinEntry()`).
  4. `#manualLoginOverlay` -> closes Add User dialog (`hideManualLogin()`).
  5. `#profileSelection` -> calls `profiles.goBack()`, which hides `#profileSelection` and returns to the server selection screen (`.container`).
  6. Otherwise calls `webOS.platformBack()`.

#### 3. `handleSuccessManifest(data, baseurl)` & `startProfileSelection(serverInfo, options)`
- Instead of calling `handoff(hosturl)` directly after fetching `/web/manifest.json`, `handleSuccessManifest` resolves or creates the `serverInfo` entry in `connected_servers` and calls:
  ```js
  startProfileSelection(serverInfo, { forceShowSelection: false, allowAutoSignIn: true });
  ```
- When `profiles.init(...)` invokes its success callback `function(user, token)`, `startProfileSelection` updates `connected_servers` if `serverInfo.id` was upgraded from a fallback URL to a real `ServerId`, loads `js/webOS.js` and `css/webOS.css` via `getTextToInject()`, and invokes `handoff(serverInfo.hosturl, bundle)`.

#### 4. `handoff(url, bundle)` — Reliable Multi-Load Iframe Injection
Upstream `handoff()` used `{ once: true }` on the iframe's `load` and `unload` listeners. That caused injected scripts to be lost whenever `jellyfin-web` performed a full `location.reload()` (for example, after credential injection or language/theme changes).

In `Jellyfin-Multiuser`, `handoff()` replaces `{ once: true }` with persistent, idempotent lifecycle hooks:
- **`armUnload(win)`:** Attaches `onUnload` to the iframe's `contentWindow` (guarded by `win.__jfUnloadArmed`) on every navigation.
- **`injectEarlyScript(doc)`:** Called as soon as `onUnload`'s `setInterval(..., 0)` sees a new `contentDocument` in `loading`/`interactive` state (guarded by `doc.__jfEarlyInjected`). Inserts `getCredentialClearScript()` as the very first child of `<head>` or `<html>` **before** `jellyfin-web`'s own bundle scripts execute and read `localStorage`.
- **`runInjection(doc)`:** Called on `DOMContentLoaded` / `load` (guarded by `doc.__jfInjected`). Injects:
  1. `window.AppInfo` and `window.DeviceInfo`
  2. `window.JellyfinCredentials` + `getCredentialInjectionScript()` (when `authenticatedUser && authToken` are present)
  3. `getSwitchUserInjectionScript()` (always injected on every load)
  4. `bundle.js` (`frontend/js/webOS.js`) and `bundle.css` (`frontend/css/webOS.css`)

#### 5. `getCredentialClearScript()` & `getCredentialInjectionScript()` — Single-Reload Credential Sync
`jellyfin-web` reads `localStorage.getItem('jellyfin_credentials')` and `localStorage.getItem('enableAutoLogin')` at boot.
- **`getCredentialClearScript()` (Early Hook):**
  - Checks if `existingCreds.Servers[0]` in the iframe's `localStorage` already has `Id === serverId`, `UserId === targetUserId`, `AccessToken === targetToken`, and `enableAutoLogin === "true"`.
  - If it already matches, sets `window.__jfCredsMatchedAtStart = true` and does nothing.
  - Otherwise, updates (or creates) the server entry in `existingCreds.Servers`, moves it to index `0` (`unshift`), writes `enableAutoLogin = "true"` and `jellyfin_credentials` to `localStorage`, and sets `window.__jfCredsOverwrittenEarly = true`.
- **`getCredentialInjectionScript()` (Load Hook):**
  - Ensures `jellyfin_credentials` and `enableAutoLogin` are written even if `injectEarlyScript` lost the race with the parser.
  - Checks `matchedBeforeLoad`: if credentials already matched before `jellyfin-web` booted, no reload is needed.
  - If credentials had to be overwritten and `jellyfin-web` may have already read stale credentials during startup, triggers **at most one** `location.reload()`, guarded by `sessionStorage.setItem('jf_webos_injected_' + targetUserId, 'true')` (while cleaning up `jf_webos_injected_*` keys from any previously active user).

#### 6. `getSwitchUserInjectionScript()` — In-App "Switch User" Buttons & Sign-Out Interception
Runs inside the `jellyfin-web` iframe (guarded by `window.__jfSwitchUserInitialized`) and performs two jobs:
1. **`ensureButtons()` (run immediately, on a 1000ms interval, and via `MutationObserver`):**
   - **Top Header Bar (`#jf-switch-user-header-btn`):** Finds `.headerRight` (or `.skinHeader`) and inserts a `<button is="paper-icon-button-light" class="headerButton headerButtonRight paper-icon-button-light show-focus jf-switch-user">` with a vector switch-user SVG icon immediately before `.headerUserButton`.
   - **User Preferences Menu (`#jf-switch-user-prefs-btn`):** Finds `#myPreferencesMenuPage` (or `.myPreferencesMenuPage`) and locates `.btnLogout` (or any menu item whose text is `"Sign out"` / `"Log out"`). Creates an `<a id="jf-switch-user-prefs-btn">` cloning `.btnLogout`'s classes (`emby-button listItem-border show-focus`) and **appends it after `.btnLogout` via `logoutEl.parentNode.appendChild(pBtn)`**.
   - *Why `appendChild` after `.btnLogout` and why `.show-focus`:*
     - In `jellyfin-web`'s TV layout (`layout-tv`), spatial focus navigation highlights focused elements using the `.show-focus` class.
     - Furthermore, `jellyfin-web` renders parts of the preferences list with React/virtual DOM; inserting a DOM node *before* `.btnLogout` shifts sibling child indices and can cause React reconciliation errors, whereas appending at the end of `.btnLogout.parentNode` preserves all existing child indices.
2. **Capture-Phase `click` Listener on `document`:**
   - Intercepts clicks on `.btnLogout` or any button/link labeled `"sign out"` / `"log out"` / `"logout"`.
   - Instead of letting `jellyfin-web` call `DELETE /Sessions/Logout` (which would invalidate the stored `AccessToken` on the Jellyfin server!), it calls `evt.preventDefault(); evt.stopPropagation();` and sends `window.parent.postMessage({ type: "showProfiles" }, "*")`.

#### 7. `window.addEventListener('message', ...)`
- **`case 'showProfiles'`:** Clears `authenticatedUser` and `authToken`, hides `#contentFrame`, and calls `startProfileSelection(serverToShow, { forceShowSelection: true })` so the user lands directly on the "Who's watching?" screen with all saved tokens intact.
- **`case 'selectServer'`:** Clears active auth, hides `#contentFrame`, shows `.container`, and restarts local server discovery (`startDiscovery()`).

---

### 3.4 `frontend/css/profiles.css` — 10-Foot TV Styling & Override Rules

- **Overriding `frontend/css/main.css` Global `button` Rules:**
  - Upstream `frontend/css/main.css` declares a global `button { width: 100%; ... }` rule designed for the narrow server-connection form.
  - `frontend/css/profiles.css` explicitly overrides `width`, `min-width`, `padding`, and `box-sizing` on `.profile-card`, `.profile-action-btn`, `.pin-buttons .btn`, `.keypad-btn`, and `.switch-server-btn` so buttons inside flex/grid overlays size properly.
- **Unified Card + Attached Action Drawer (`.profile-column.is-selected.has-actions`):**
  - When a saved profile is selected, `.profile-column.is-selected.has-actions .profile-card` zeroes out its bottom border-radius (`border-radius: 16px 16px 0 0`) and merges seamlessly with `.profile-actions-drawer` (`border-radius: 0 0 16px 16px`), creating a single cohesive cyan-bordered column (`#00a4dc`) that expands smoothly without shifting horizontal column alignment (`align-items: flex-start` on `#profileGrid`).
- **3x4 Numeric Keypad (`.numeric-keypad` & `.keypad-btn`):**
  - Uses CSS flex wrapping (`width: 300px`, 3 buttons per row at `84px x 64px` each) with high-contrast focus scaling (`transform: scale(1.06)`, `#00a4dc` border and glow) for clear visibility from 10 feet away.

---

### 3.5 `tools/verify-code.js` — Automated Static & ES5 AST Verification

Executed via `npm test` (both locally and in CI before packaging the IPK), `tools/verify-code.js` runs four verification suites:
1. **JSON & Package Metadata Validation:** Verifies that `package.json`, `frontend/appinfo.json`, `services/package.json`, and `services/services.json` all contain valid JSON, matching `version` (`1.0.0`), matching app ID (`nl.timsas.jellyfin.multiuser`), and matching service prefix (`nl.timsas.jellyfin.multiuser.service`).
2. **LF Line Endings Check:** Ensures no source, script, workflow, or documentation file contains Windows CRLF (`\r`) line endings.
3. **Syntax & Security Pattern Check:** Compiles every JS file with Node's `vm.Script` and scans all frontend JS files to ensure no `eval()` or `new Function()` calls exist.
4. **Strict ES5 AST Verification (Static + Generated Scripts):**
   - Loads `frontend/js/index.js` inside a sandboxed `vm` context, simulates an authenticated user whose name contains quotes (`tsas"test`), and executes `getCredentialClearScript()`, `getCredentialInjectionScript()`, and `getSwitchUserInjectionScript()`.
   - Runs `npx acorn@8 --ecma5` across all frontend `.js` files **and** all three dynamically generated iframe injection scripts to guarantee 100% strict ES5 compliance and proper string escaping.

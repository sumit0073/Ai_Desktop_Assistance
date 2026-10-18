# macOS signing & notarization — step-by-step guide

This removes the Gatekeeper warning: *“Apple could not verify ‘System Bunny’ is free of malware…”*

You need a **Mac** for certificate creation and export. Builds can then run on your Mac or in GitHub Actions (`Build macOS DMG`).

Official Tauri reference: [macOS Code Signing](https://v2.tauri.app/distribute/sign/macos/)

---

## What you already have vs what you still need

| Thing | Meaning |
|--------|---------|
| **Apple ID** | Your login email for Apple |
| **Apple Developer Program** (paid) | Membership that lets you create distribution certificates (~$99/year) |
| **Developer ID Application certificate** | The actual signing cert you create *inside* the developer account — this is what signs the `.app` / `.dmg` |
| **Notarization credentials** | Apple ID app-specific password *or* App Store Connect API key — used so Apple can scan and approve each build |

Having “Developer ID” / membership is **not** enough by itself. You must create a **Developer ID Application** certificate and turn on **notarization**.

This project currently uses **ad-hoc** signing (`signingIdentity: "-"`), which always triggers the warning for downloaded apps.

---

## Overview (order of steps)

1. Create a Certificate Signing Request (CSR) on a Mac  
2. Create a **Developer ID Application** certificate on the Apple Developer website  
3. Install the certificate in Keychain  
4. Export a `.p12` for CI (and encode it)  
5. Set up notarization login (Apple ID *or* API key)  
6. Add GitHub secrets  
7. Point this repo’s Mac build at real signing (remove `"-"`)  
8. Rebuild the DMG and test on a clean Mac  

---

## Step 1 — Create a Certificate Signing Request (CSR) on your Mac

You do this **on a Mac**, in **Keychain Access**.

1. Open **Keychain Access**  
   - Finder → Applications → Utilities → **Keychain Access**  
   - Or Spotlight: type `Keychain Access`

2. Menu bar: **Keychain Access** → **Certificate Assistant** → **Request a Certificate From a Certificate Authority…**

3. Fill the Certificate Assistant dialog exactly like this:

   | Field | What to enter |
   |--------|----------------|
   | **User Email Address** | The email of your Apple ID that is on the Developer account (e.g. `you@company.com`) |
   | **Common Name** | Any label for the private key, e.g. `System Bunny Developer ID` or `Your Name Dev Key` |
   | **CA Email Address** | **Leave empty** |
   | **Request is** | Select **Saved to disk** |
   | **Let me specify key pair information** | Leave **unchecked** (default is fine for Developer ID Application) |

4. Click **Continue**.

5. Save the file somewhere easy (Desktop is fine).  
   Filename will look like: `CertificateSigningRequest.certSigningRequest`

Keep that file. You upload it in the next step.

---

## Step 2 — Create the Developer ID Application certificate (Apple website)

1. Sign in at: [https://developer.apple.com/account](https://developer.apple.com/account)  
   Use the Apple ID that has **paid** Developer Program access.

2. Open **Certificates, Identifiers & Profiles**  
   Direct link: [https://developer.apple.com/account/resources/certificates/list](https://developer.apple.com/account/resources/certificates/list)

3. Click the **+** (Add) button to create a new certificate.

4. **Select a certificate type** — this is the important choice:

   | Do **not** select | Select **this** |
   |-------------------|-----------------|
   | Apple Development | |
   | Apple Distribution | |
   | Mac App Distribution | |
   | Mac Installer Distribution | |
   | **Developer ID Application** | ← **Yes — for DMGs downloaded from GitHub / your website** |
   | Developer ID Installer | Only if you ship a separate `.pkg` installer that needs its own installer signature (usually not required for Tauri DMG first) |

   Why: System Bunny is distributed **outside the Mac App Store** as a `.dmg`. That requires **Developer ID Application** + notarization.

5. Click **Continue**.

6. If Apple asks which CSR / platform details:
   - Confirm you are creating a **Developer ID Application** cert for macOS software distributed outside the App Store.
   - Click **Continue** / **Choose File**.

7. **Upload CSR**:
   - Choose the `CertificateSigningRequest.certSigningRequest` from Step 1.
   - Click **Continue**.

8. Click **Download** to get a `.cer` file (e.g. `developerID_application.cer`).

**Note:** Only the **Account Holder** of the team can create Developer ID certificates. If you are an Admin/Developer on someone else’s team and the option is missing, ask the Account Holder to create it (or transfer Account Holder).

---

## Step 3 — Install the certificate in Keychain

1. Double-click the downloaded `.cer` file.  
   It should open Keychain Access and add the cert.

2. In Keychain Access:
   - Left sidebar: under **Default Keychains**, select **login** (not “System” unless you know you need that).
   - Top category: **My Certificates**.
   - Find an entry like:  
     `Developer ID Application: Your Name (ABCDE12345)`

3. Confirm the signing identity is valid in Terminal:

   ```bash
   security find-identity -v -p codesigning
   ```

   Look for a line containing **Developer ID Application**. Copy that full quoted name later — that is your **signing identity**.

   Example:

   ```text
   1) A1B2C3D4... "Developer ID Application: Seecog Inc (TEAM12ID34)"
   ```

If it does **not** appear under **My Certificates**, the private key from the CSR is missing (CSR was made on a different Mac, or key was deleted). Create a **new** CSR on *this* Mac and create a **new** certificate.

---

## Step 4 — Export `.p12` for GitHub Actions (CI)

Do this on the same Mac where the cert + private key live.

1. Keychain Access → **login** → **My Certificates**.
2. Find **Developer ID Application: …**
3. Click the **disclosure triangle** so you see the private key under it.
4. Select the certificate row (or the key), then **right-click** → **Export “…”**.
5. Export dialog:

   | Field | What to choose |
   |--------|----------------|
   | **File Format** | **Personal Information Exchange (.p12)** |
   | **Save As** | e.g. `SystemBunny-DeveloperID.p12` |
   | **Password** | Choose a strong password — you will store this as a GitHub secret |
   | **Verify** | Same password |

6. If macOS asks for your login keychain password to allow export, enter it and **Allow**.

7. Convert to a single-line base64 string (for the `APPLE_CERTIFICATE` secret):

   ```bash
   openssl base64 -A -in ~/Desktop/SystemBunny-DeveloperID.p12 -out ~/Desktop/certificate-base64.txt
   ```

8. Open `certificate-base64.txt` — you will paste **all** of its contents into GitHub Secrets (Step 6).  
   Keep the `.p12` and password safe (password manager). Do **not** commit them to git.

---

## Step 5 — Set up notarization (Apple must scan each build)

Signing alone is not enough for modern macOS. Choose **one** method.

### Option A — Apple ID + app-specific password (simplest)

1. Go to [https://appleid.apple.com](https://appleid.apple.com) and sign in.

2. **Sign-In and Security** → **App-Specific Passwords** → generate one:
   - Label: e.g. `System Bunny Notarization`
   - Copy the password shown once (xxxx-xxxx-xxxx-xxxx).

3. Find your **Team ID**:
   - [https://developer.apple.com/account](https://developer.apple.com/account) → **Membership details**
   - Copy **Team ID** (10 characters, e.g. `TEAM12ID34`).

You will store:

| Secret / env | Value |
|--------------|--------|
| `APPLE_ID` | Your Apple ID email |
| `APPLE_PASSWORD` | The **app-specific** password (not your normal Apple password) |
| `APPLE_TEAM_ID` | Team ID from Membership |

### Option B — App Store Connect API key (often better for CI)

1. Go to [App Store Connect → Users and Access](https://appstoreconnect.apple.com/access/integrations/api)  
   (Integrations → **Team Keys** / App Store Connect API — UI labels vary slightly).

2. Click **Generate API Key** / **+**:
   - **Name**: e.g. `System Bunny CI`
   - **Access**: **Developer** (or Admin if your org requires it)

3. After creation, note:
   - **Issuer ID** (top of the keys page) → becomes `APPLE_API_ISSUER`
   - **Key ID** → becomes `APPLE_API_KEY`

4. Download the `.p8` private key file (**only once**). Store it safely.

5. For local builds, set `APPLE_API_KEY_PATH` to the path of that `.p8`.  
   For GitHub Actions, store the `.p8` contents (or file) as a secret and write it to a temp path in the workflow before build.

You only need **Option A or Option B**, not both.

---

## Step 6 — Add GitHub repository secrets

1. Open your GitHub repo → **Settings** → **Secrets and variables** → **Actions**.
2. Click **New repository secret** for each:

### Required for signing

| Secret name | Paste |
|-------------|--------|
| `APPLE_CERTIFICATE` | Full contents of `certificate-base64.txt` (one long line) |
| `APPLE_CERTIFICATE_PASSWORD` | Password you set when exporting the `.p12` |

### Required for notarization (Option A)

| Secret name | Paste |
|-------------|--------|
| `APPLE_ID` | Apple ID email |
| `APPLE_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | 10-character Team ID |

### Optional but helpful

| Secret name | Paste |
|-------------|--------|
| `APPLE_SIGNING_IDENTITY` | Exact string from `security find-identity`, e.g. `Developer ID Application: Seecog Inc (TEAM12ID34)` |
| `KEYCHAIN_PASSWORD` | Any random password used only for a temporary CI keychain (if your workflow creates one) |

Do **not** put these values in `.env` committed to the repo.

---

## Step 7 — Wire this repo (what must change)

Today:

- [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json) has `"signingIdentity": "-"`
- [`.github/workflows/build-macos.yml`](../.github/workflows/build-macos.yml) sets `APPLE_SIGNING_IDENTITY: "-"`

Those force **ad-hoc** signing and keep the malware warning.

**What to change (conceptually):**

1. Set `bundle.macOS.signingIdentity` to your real identity **or** leave it unset and supply `APPLE_SIGNING_IDENTITY` / `APPLE_CERTIFICATE` in CI.
2. In the **Build macOS DMG** workflow, **remove** `APPLE_SIGNING_IDENTITY: "-"`.
3. Pass into the build step env:

   ```text
   APPLE_CERTIFICATE
   APPLE_CERTIFICATE_PASSWORD
   APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID
   (or API key vars)
   APPLE_SIGNING_IDENTITY   # recommended
   ```

4. Keep using:

   ```bash
   npm run tauri -- build --target <arch> --bundles dmg
   ```

   With the env vars set, Tauri signs and notarizes during the build.

5. Update the GitHub Release body text that still says “right-click → Open (unsigned / ad-hoc signed build).”

Ask in chat when you want these workflow/config edits applied for you after secrets exist.

---

## Step 8 — Build and verify

1. Run **Actions → Build macOS DMG → Run workflow** (or tag a release as you usually do).
2. Wait for both Apple Silicon and Intel jobs to finish.
3. Download the new `.dmg` from the Release / artifacts.
4. On a Mac that did **not** build it (or another user account):
   - Open the DMG normally (double-click).
   - Drag System Bunny to Applications and launch.
5. **Success:** app opens without “Apple could not verify…” / Move to Bin.  
   **Still blocked:** notarization failed or identity still `-` — check the workflow logs for `notarization` / `codesign` errors.

Optional local check after a signed build:

```bash
spctl --assess --verbose /Applications/System\ Bunny.app
codesign -dv --verbose=4 /Applications/System\ Bunny.app
```

---

## Quick “what do I select?” cheat sheet

| Screen | Select / fill |
|--------|----------------|
| Keychain CSR | Email = Apple ID email; Common Name = any key label; CA Email = empty; **Saved to disk** |
| Apple certificate type | **Developer ID Application** |
| Keychain export | **.p12** + password |
| Notarization | App-specific password **or** App Store Connect API key |
| GitHub | Secrets listed in Step 6 |
| This repo | Remove ad-hoc `"-"`; inject secrets into Mac build |

---

## Common failures

| Problem | Likely cause |
|---------|----------------|
| No “Developer ID Application” option | Not paid member, or not Account Holder |
| Cert installs but `find-identity` empty | CSR/key from another Mac; recreate CSR + cert on this Mac |
| Build works but warning remains | Still using `signingIdentity: "-"` or notarization env missing |
| Notarization auth error | Used normal Apple password instead of **app-specific** password |
| `.p8` download gone | API keys can only be downloaded once — generate a new key |

---

## Microphone not listed in System Settings

`Info.plist` already has `NSMicrophoneUsageDescription`. The Mac build also needs [`Entitlements.plist`](../src-tauri/Entitlements.plist) with `com.apple.security.device.audio-input` (wired via `bundle.macOS.entitlements`). Without that entitlement—especially under Hardened Runtime—macOS can deny the mic **silently**: no prompt and **no row** under Privacy & Security → Microphone.

After rebuilding a DMG that includes entitlements:

1. Open System Bunny and use **Check microphone** or start **Record** (that triggers the OS request).
2. Accept the system dialog when it appears.
3. If it still never appears, reset TCC for this app (Terminal), then try again:

   ```bash
   tccutil reset Microphone com.systembunny.app
   ```

### Windows is not the same flow

Windows **NSIS/MSI** builds (what this repo ships) are classic Win32 apps. They do **not** need an `Entitlements.plist` equivalent for microphone. There is no macOS-style “missing entitlement → silent deny + never listed” bug for those installers.

What *does* apply on Windows:

- Settings → Privacy & security → Microphone must allow access (including desktop apps if that toggle appears).
- **Check mic** uses WebView2 `getUserMedia`; the app auto-allows the webview microphone permission in Rust so WebView2 does not add an extra deny layer. OS privacy still applies.
- Native **Record** uses WASAPI/`cpal` and does not depend on macOS-style code-signing entitlements.

## Windows (separate track)

macOS signing does **not** fix Windows SmartScreen. For Windows you need a separate **Authenticode** code-signing certificate and signing of the `.exe` / `.msi` in the Windows workflow. Do Mac first with this guide; then tackle Windows.

---

## Checklist

- [ ] CSR created on Mac (Saved to disk)  
- [ ] **Developer ID Application** certificate created and downloaded  
- [ ] Cert visible in Keychain → My Certificates  
- [ ] `security find-identity -v -p codesigning` shows Developer ID Application  
- [ ] `.p12` exported and base64 encoded  
- [ ] Notarization credentials ready (Apple ID path or API key)  
- [ ] GitHub secrets added  
- [ ] Repo no longer forces `APPLE_SIGNING_IDENTITY: "-"`  
- [ ] New DMG opens cleanly on a test Mac  

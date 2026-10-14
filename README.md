# System Bunny

Two-hour MVP foundation: a frameless, transparent, always-on-top Tauri v2 overlay with a React + TypeScript frontend and Supabase authentication.

## Stack

- **Frontend:** React + TypeScript (Vite)
- **Desktop shell:** Tauri 2 + Rust
- **Auth / sessions:** Supabase

## Window behavior

Configured in `src-tauri/tauri.conf.json` (and reinforced in `tauri.windows.conf.json`):

- Transparent
- Frameless (`decorations: false`)
- Always on top
- `skipTaskbar: true` (Windows)
- Content protection enabled

Rust command `enable_content_protection` calls `window.set_content_protected(true)`.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy env and add your Supabase project values:

```bash
copy .env.example .env
```

3. Run the UI in the browser:

```bash
npm run dev
```

4. Run the native app (requires Rust, WebView2, and **Visual Studio Build Tools** with the C++ workload on Windows):

```bash
npm run tauri:dev
```

If `cargo` fails with `linker link.exe not found`, install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) and select **Desktop development with C++**.

### Auth flow

- `src/pages/LoginPage.tsx` — email/password sign-in via Supabase Auth  
- `src/pages/OtpLoginPage.tsx` — email or SMS one-time code sign-in  
- `src/pages/SignupPage.tsx` — name, email, phone, password + strength meter  
- Sessions are persisted with PKCE; app usage rows go to `public.sessions`  
- Put only the **anon** key in `.env` (never `service_role`)  
- OTP provider setup: [`docs/auth-otp-setup.md`](docs/auth-otp-setup.md)

### Global shortcuts (Tauri)

Registered with `tauri-plugin-global-shortcut` (works while other apps are focused):

| Shortcut | Action |
| --- | --- |
| `Ctrl/⌘ + Shift + A` | Toggle overlay hide/show (global — no click needed) |
| `Ctrl/⌘ + H` | Capture the desktop (any app), then send to AI analysis |
| `Ctrl/⌘ + G` | Send the chat question to AI; if empty, clear/reset the view |
| `Shift + ↑/↓` | Scroll chat (global) |
| `Ctrl/⌘ + arrows` | Nudge the overlay window (global) |

**Close** quits the app.

The window stays **resizable** and **movable** (drag the top bar).

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Vite frontend only |
| `npm run tauri:dev` | Full Tauri desktop app |
| `npm run tauri:build` | Production installer build |
| `npm run tauri:build:mac` | macOS `.dmg` bundle (must run on a Mac) |
| `npm run tauri:build:win` | Windows NSIS `.exe` + WiX `.msi` |

Docker is **not** part of this project. Supabase work uses the hosted project + CLI
(`link` / `db push` / `secrets` / `functions deploy`), not local containers.

## Download installers (GitHub Actions)

This is a **desktop** app (Windows + macOS). Builds produce `.exe` / `.msi` / `.dmg`
installers — not an Android APK.

### One-click: both platforms

1. Add repository **Secrets** (Settings → Secrets and variables → Actions):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_STT_PROXY_URL` (e.g. `https://<ref>.supabase.co/functions/v1/stt-proxy`)
   - `VITE_CHAT_PROXY_URL` (e.g. `https://<ref>.supabase.co/functions/v1/chat-proxy`)
2. Optional **Variables**: `VITE_GROQ_MODEL`, `VITE_GROQ_VISION_MODEL`
3. Open [Actions → Build Desktop Installers](https://github.com/sumit0073/Ai_Desktop_Assistance/actions/workflows/build-desktop.yml)
4. **Run workflow** → wait for Windows + macOS jobs
5. Download from:
   - **Releases**: https://github.com/sumit0073/Ai_Desktop_Assistance/releases  
   - or the workflow run **Artifacts** (`SystemBunny-Windows-x64`, `SystemBunny-macOS-*`)

Do **not** put `VITE_GROQ_API_KEY` in release builds — set `GROQ_API_KEY` as a  
Supabase Edge Function secret. See [docs/proxy-deploy.md](docs/proxy-deploy.md) and  
[docs/production-readiness.md](docs/production-readiness.md).

| Platform | File | Notes |
| --- | --- | --- |
| Windows | `.exe` (NSIS) | Recommended installer |
| Windows | `.msi` | Enterprise / silent deploy |
| macOS Apple Silicon | `.dmg` (`aarch64`) | M1–M4 |
| macOS Intel | `.dmg` (`x64` / `x86_64`) | First open: right-click → **Open** |

Single-platform workflows still exist if you only need one OS:  
[Build Windows Installer](https://github.com/sumit0073/Ai_Desktop_Assistance/actions/workflows/build-windows.yml) ·  
[Build macOS DMG](https://github.com/sumit0073/Ai_Desktop_Assistance/actions/workflows/build-macos.yml).

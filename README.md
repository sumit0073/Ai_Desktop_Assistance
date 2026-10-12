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
- `src/pages/SignupPage.tsx` — name, email, phone, password + strength meter  
- Sessions are persisted with PKCE; app usage rows go to `public.sessions`  
- Put only the **anon** key in `.env` (never `service_role`)

Without a real anon key, use **Continue in demo mode** on the landing page.

### Global shortcuts (Tauri)

Registered with `tauri-plugin-global-shortcut` (works while other apps are focused):

| Shortcut | Action |
| --- | --- |
| `Ctrl/⌘ + Shift + A` | Toggle overlay hide/show |
| `Ctrl/⌘ + H` | Capture the desktop (any app), then send to AI analysis |
| `Ctrl/⌘ + G` | Send the chat question to AI; if empty, clear/reset the view |

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

## Download installers (GitHub Actions)

Optional (so built apps have working auth/AI): add repository secrets  
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GROQ_API_KEY`  
under **Settings → Secrets and variables → Actions**.

Installers appear on **Releases**: https://github.com/sumit0073/Ai_Desktop_Assistance/releases  
(or as workflow **Artifacts**).

### Windows (EXE / MSI)

1. Open [Actions → Build Windows Installer](https://github.com/sumit0073/Ai_Desktop_Assistance/actions/workflows/build-windows.yml)
2. Click **Run workflow** → **Run workflow**
3. Download the **NSIS `.exe`** (recommended) or **`.msi`**

Requires WebView2 (usually already on Windows 10/11).

### Mac (DMG)

A real `.dmg` must be built on a Mac runner.

1. Open [Actions → Build macOS DMG](https://github.com/sumit0073/Ai_Desktop_Assistance/actions/workflows/build-macos.yml)
2. Click **Run workflow** → **Run workflow**
3. Download the `.dmg` for Apple Silicon (`aarch64`) or Intel (`x64`)

On first launch, macOS may block the unsigned build: right-click the app → **Open**.

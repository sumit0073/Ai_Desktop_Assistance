use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use xcap::Monitor;

/// True only after the user intentionally hid the overlay (⌘/Ctrl+A).
/// Prevents “restore” from being treated as “hide” when Chrome steals focus
/// but macOS still reports the window as visible.
static OVERLAY_USER_HIDDEN: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShortcutPayload {
    action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    image_base64: Option<String>,
}

/// Prevents the window contents from being captured by screen recording / screenshots.
#[tauri::command]
fn enable_content_protection(window: WebviewWindow) -> Result<(), String> {
    window
        .set_content_protected(true)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_main_window(app: AppHandle) -> Result<(), String> {
    toggle_window_visibility(&app)
}

#[tauri::command]
fn capture_screen_png(app: AppHandle) -> Result<String, String> {
    capture_desktop_for_ai(&app)
}

fn toggle_window_visibility(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    let user_hidden = OVERLAY_USER_HIDDEN.load(Ordering::SeqCst);
    let visible = window.is_visible().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);

    // Only hide when the overlay is actually frontmost. If Chrome (or another
    // app) stole focus, the window may still report visible=true while the user
    // cannot see it — in that case restore instead of hiding again.
    if !user_hidden && visible && focused {
        window.hide().map_err(|e| e.to_string())?;
        OVERLAY_USER_HIDDEN.store(true, Ordering::SeqCst);
    } else {
        restore_main_window(app)?;
    }
    Ok(())
}

/// Bring the overlay back after minimize/hide (no taskbar icon when skipTaskbar is on).
fn restore_main_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    // Unhide the macOS application itself if the OS hid it when switching apps.
    #[cfg(target_os = "macos")]
    {
        let _ = app.show();
    }

    if window.is_minimized().unwrap_or(false) {
        window.unminimize().map_err(|e| e.to_string())?;
    }

    // Re-assert overlay stacking — Chrome activation can leave the window buried.
    let _ = window.set_always_on_top(true);
    #[cfg(target_os = "macos")]
    {
        let _ = window.set_visible_on_all_workspaces(true);
    }

    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    let _ = window.set_content_protected(true);
    OVERLAY_USER_HIDDEN.store(false, Ordering::SeqCst);
    Ok(())
}

/// Capture, downscale, and JPEG-compress for Groq vision (20MB request limit).
fn capture_primary_monitor_png() -> Result<String, String> {
    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    let monitor = monitors
        .into_iter()
        .next()
        .ok_or_else(|| "No display found for capture".to_string())?;

    let rgba = monitor.capture_image().map_err(|e| e.to_string())?;
    let mut img = image::DynamicImage::ImageRgba8(rgba);

    const MAX_WIDTH: u32 = 1280;
    if img.width() > MAX_WIDTH {
        let new_height = (img.height() as f64 * (MAX_WIDTH as f64 / img.width() as f64))
            .round()
            .max(1.0) as u32;
        img = img.resize_exact(MAX_WIDTH, new_height, image::imageops::FilterType::Triangle);
    }

    let rgb = img.to_rgb8();
    let mut jpeg_bytes: Vec<u8> = Vec::new();
    {
        let mut cursor = Cursor::new(&mut jpeg_bytes);
        let mut encoder =
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, 70);
        encoder
            .encode(
                rgb.as_raw(),
                rgb.width(),
                rgb.height(),
                image::ExtendedColorType::Rgb8,
            )
            .map_err(|e| e.to_string())?;
    }

    Ok(STANDARD.encode(jpeg_bytes))
}

/// Hide overlay briefly so the capture includes other apps under the cursor desktop.
fn capture_desktop_for_ai(app: &AppHandle) -> Result<String, String> {
    let window = app.get_webview_window("main");

    if let Some(ref window) = window {
        let _ = window.hide();
        std::thread::sleep(Duration::from_millis(120));
    }

    let result = capture_primary_monitor_png();

    if window.is_some() {
        let _ = restore_main_window(app);
    }

    result
}

fn emit_shortcut(app: &AppHandle, action: &str, image_base64: Option<String>) {
    let _ = app.emit(
        "seecog://shortcut",
        ShortcutPayload {
            action: action.to_string(),
            image_base64,
        },
    );
}

fn modifier_chord() -> Modifiers {
    #[cfg(target_os = "macos")]
    {
        Modifiers::SUPER
    }
    #[cfg(not(target_os = "macos"))]
    {
        Modifiers::CONTROL
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let chord = modifier_chord();
    let chord_for_handler = chord;

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }

                    if shortcut.matches(chord_for_handler | Modifiers::SHIFT, Code::KeyA) {
                        let _ = toggle_window_visibility(app);
                        return;
                    }

                    if shortcut.matches(chord_for_handler, Code::KeyH) {
                        match capture_desktop_for_ai(app) {
                            Ok(image_base64) => {
                                emit_shortcut(app, "screenshot-analyze", Some(image_base64));
                            }
                            Err(err) => {
                                eprintln!("Screenshot capture failed: {err}");
                                emit_shortcut(app, "screenshot-error", None);
                            }
                        }
                        return;
                    }

                    if shortcut.matches(chord_for_handler, Code::KeyG) {
                        emit_shortcut(app, "analyze-chat", None);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            enable_content_protection,
            toggle_main_window,
            capture_screen_png
        ])
        .setup(move |app| {
            // Overlay-style app: no Dock bounce fighting Chrome; matches skipTaskbar.
            #[cfg(target_os = "macos")]
            {
                let _ = app
                    .handle()
                    .set_activation_policy(tauri::ActivationPolicy::Accessory);
            }

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_content_protected(true);
                let _ = window.set_resizable(true);
                let _ = window.set_always_on_top(true);
                #[cfg(target_os = "macos")]
                {
                    let _ = window.set_visible_on_all_workspaces(true);
                }
            }

            // Prefer ⌘/Ctrl+Shift+A for hide/show — plain ⌘+A is "Select All" on
            // macOS and often fails to register as a global shortcut.
            let hide_show = Shortcut::new(Some(chord | Modifiers::SHIFT), Code::KeyA);
            let shortcuts = [
                hide_show,
                Shortcut::new(Some(chord), Code::KeyH),
                Shortcut::new(Some(chord), Code::KeyG),
            ];

            for shortcut in shortcuts {
                if let Err(err) = app.global_shortcut().register(shortcut) {
                    eprintln!("Failed to register shortcut {shortcut:?}: {err}");
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

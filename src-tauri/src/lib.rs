mod audio;

use std::io::Cursor;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::thread;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use xcap::Monitor;

use audio::{
    ack_speech_segment, meeting_capture_status, start_meeting_capture, stop_meeting_capture,
    MeetingCaptureState,
};

/// True only after the user intentionally hid the overlay (⌘/Ctrl+Shift+A).
/// Prevents “restore” from being treated as “hide” when Chrome steals focus
/// but the OS still reports the window as visible.
static OVERLAY_USER_HIDDEN: AtomicBool = AtomicBool::new(false);

const WINDOW_NUDGE_LOGICAL: i32 = 30;
const MIN_VISIBLE_PHYSICAL_PX: i32 = 64;
/// Wait after the first step before continuous repeat (keyboard-style).
const HOLD_REPEAT_DELAY_MS: u64 = 420;
/// Interval between continuous steps while the chord is held.
const HOLD_TICK_MS: u64 = 140;

const HOLD_NONE: u8 = 0;
const HOLD_SCROLL_UP: u8 = 1;
const HOLD_SCROLL_DOWN: u8 = 2;
const HOLD_NUDGE_UP: u8 = 3;
const HOLD_NUDGE_DOWN: u8 = 4;
const HOLD_NUDGE_LEFT: u8 = 5;
const HOLD_NUDGE_RIGHT: u8 = 6;

/// Active hold-to-repeat action for Shift/Ctrl arrow chords.
static HOLD_KIND: AtomicU8 = AtomicU8::new(HOLD_NONE);
static HOLD_TICKER_RUNNING: AtomicBool = AtomicBool::new(false);

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
    let minimized = window.is_minimized().unwrap_or(false);

    // Toggle on visibility, not focus. Restore intentionally leaves keyboard
    // focus with the other app (Chrome/meeting), so requiring focus made
    // Ctrl+Shift+A able to show once and then never hide again.
    if user_hidden || !visible || minimized {
        restore_main_window(app)?;
    } else {
        window.hide().map_err(|e| e.to_string())?;
        OVERLAY_USER_HIDDEN.store(true, Ordering::SeqCst);
    }
    Ok(())
}

/// Bring the overlay back without stealing keyboard focus from the front app.
fn restore_main_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    #[cfg(target_os = "macos")]
    {
        let _ = app.show();
    }

    if window.is_minimized().unwrap_or(false) {
        window.unminimize().map_err(|e| e.to_string())?;
    }

    let _ = window.set_always_on_top(true);
    #[cfg(target_os = "macos")]
    {
        let _ = window.set_visible_on_all_workspaces(true);
    }

    window.show().map_err(|e| e.to_string())?;
    // Do NOT set_focus() — that activates the window and paints the OS focus
    // highlight. Overlay stays on top; Chrome/other apps keep keyboard focus.
    strip_os_focus_chrome(&window);
    let _ = window.set_content_protected(true);
    OVERLAY_USER_HIDDEN.store(false, Ordering::SeqCst);
    Ok(())
}

/// Remove Windows DWM focus/accent border so the overlay does not “light up”
/// when clicked. No-op on other platforms.
fn strip_os_focus_chrome(window: &WebviewWindow) {
    #[cfg(windows)]
    {
        use windows::Win32::Graphics::Dwm::{
            DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_COLOR_NONE,
        };

        if let Ok(hwnd) = window.hwnd() {
            let color = DWMWA_COLOR_NONE;
            unsafe {
                let _ = DwmSetWindowAttribute(
                    hwnd,
                    DWMWA_BORDER_COLOR,
                    &color as *const _ as *const _,
                    std::mem::size_of_val(&color) as u32,
                );
                let _ = DwmSetWindowAttribute(
                    hwnd,
                    DWMWA_CAPTION_COLOR,
                    &color as *const _ as *const _,
                    std::mem::size_of_val(&color) as u32,
                );
            }
        }
    }
    let _ = window;
}

fn clamp_to_monitors(
    x: i32,
    y: i32,
    win_w: i32,
    win_h: i32,
    monitors: &[tauri::Monitor],
    min_visible: i32,
) -> (i32, i32) {
    if monitors.is_empty() {
        return (x, y);
    }

    let mut best = (x, y);
    let mut best_dist = i64::MAX;

    for monitor in monitors {
        let area = monitor.work_area();
        let ax = area.position.x;
        let ay = area.position.y;
        let aw = area.size.width as i32;
        let ah = area.size.height as i32;
        let min_x = ax - win_w + min_visible;
        let max_x = ax + aw - min_visible;
        let min_y = ay - win_h + min_visible;
        let max_y = ay + ah - min_visible;
        let cx = x.clamp(min_x, max_x);
        let cy = y.clamp(min_y, max_y);
        let dx = (cx - x) as i64;
        let dy = (cy - y) as i64;
        let dist = dx * dx + dy * dy;
        if dist < best_dist {
            best_dist = dist;
            best = (cx, cy);
        }
    }

    best
}

fn nudge_main_window(app: &AppHandle, dx_logical: i32, dy_logical: i32) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    if window.is_maximized().unwrap_or(false) {
        return Ok(());
    }

    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let dx = ((dx_logical as f64) * scale).round() as i32;
    let dy = ((dy_logical as f64) * scale).round() as i32;

    let monitors = window.available_monitors().unwrap_or_default();
    let (nx, ny) = clamp_to_monitors(
        pos.x + dx,
        pos.y + dy,
        size.width as i32,
        size.height as i32,
        &monitors,
        MIN_VISIBLE_PHYSICAL_PX,
    );

    if nx != pos.x || ny != pos.y {
        window
            .set_position(PhysicalPosition::new(nx, ny))
            .map_err(|e| e.to_string())?;
    }
    let _ = window.set_always_on_top(true);
    strip_os_focus_chrome(&window);
    Ok(())
}

fn apply_hold_tick(app: &AppHandle, kind: u8) {
    match kind {
        HOLD_SCROLL_UP => emit_shortcut(app, "scroll-chat-up", None),
        HOLD_SCROLL_DOWN => emit_shortcut(app, "scroll-chat-down", None),
        HOLD_NUDGE_UP => {
            let _ = nudge_main_window(app, 0, -WINDOW_NUDGE_LOGICAL);
        }
        HOLD_NUDGE_DOWN => {
            let _ = nudge_main_window(app, 0, WINDOW_NUDGE_LOGICAL);
        }
        HOLD_NUDGE_LEFT => {
            let _ = nudge_main_window(app, -WINDOW_NUDGE_LOGICAL, 0);
        }
        HOLD_NUDGE_RIGHT => {
            let _ = nudge_main_window(app, WINDOW_NUDGE_LOGICAL, 0);
        }
        _ => {}
    }
}

fn begin_hold(app: &AppHandle, kind: u8) {
    HOLD_KIND.store(kind, Ordering::SeqCst);
    // One step on press. Continuous repeat only after HOLD_REPEAT_DELAY_MS if still held.
    apply_hold_tick(app, kind);

    if HOLD_TICKER_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }

    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(HOLD_REPEAT_DELAY_MS));
        loop {
            let kind = HOLD_KIND.load(Ordering::SeqCst);
            if kind == HOLD_NONE {
                HOLD_TICKER_RUNNING.store(false, Ordering::SeqCst);
                break;
            }
            apply_hold_tick(&app, kind);
            thread::sleep(Duration::from_millis(HOLD_TICK_MS));
        }
    });
}

fn end_hold(kind: u8) {
    let _ = HOLD_KIND.compare_exchange(kind, HOLD_NONE, Ordering::SeqCst, Ordering::SeqCst);
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
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, 70);
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
        .manage(MeetingCaptureState::default())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    let pressed = event.state == ShortcutState::Pressed;
                    let released = event.state == ShortcutState::Released;

                    // Hold-to-repeat: Shift+↑/↓ scroll, Ctrl/⌘+arrows nudge.
                    if shortcut.matches(Modifiers::SHIFT, Code::ArrowUp) {
                        if pressed {
                            begin_hold(app, HOLD_SCROLL_UP);
                        } else if released {
                            end_hold(HOLD_SCROLL_UP);
                        }
                        return;
                    }
                    if shortcut.matches(Modifiers::SHIFT, Code::ArrowDown) {
                        if pressed {
                            begin_hold(app, HOLD_SCROLL_DOWN);
                        } else if released {
                            end_hold(HOLD_SCROLL_DOWN);
                        }
                        return;
                    }
                    if shortcut.matches(chord_for_handler, Code::ArrowUp) {
                        if pressed {
                            begin_hold(app, HOLD_NUDGE_UP);
                        } else if released {
                            end_hold(HOLD_NUDGE_UP);
                        }
                        return;
                    }
                    if shortcut.matches(chord_for_handler, Code::ArrowDown) {
                        if pressed {
                            begin_hold(app, HOLD_NUDGE_DOWN);
                        } else if released {
                            end_hold(HOLD_NUDGE_DOWN);
                        }
                        return;
                    }
                    if shortcut.matches(chord_for_handler, Code::ArrowLeft) {
                        if pressed {
                            begin_hold(app, HOLD_NUDGE_LEFT);
                        } else if released {
                            end_hold(HOLD_NUDGE_LEFT);
                        }
                        return;
                    }
                    if shortcut.matches(chord_for_handler, Code::ArrowRight) {
                        if pressed {
                            begin_hold(app, HOLD_NUDGE_RIGHT);
                        } else if released {
                            end_hold(HOLD_NUDGE_RIGHT);
                        }
                        return;
                    }

                    if !pressed {
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

                    // Toggle meeting Record (mic + audience) — same as the Record button.
                    if shortcut.matches(chord_for_handler, Code::KeyG) {
                        emit_shortcut(app, "toggle-record", None);
                        return;
                    }

                    // Ask AI — works while another app is focused.
                    if shortcut.matches(chord_for_handler, Code::Enter) {
                        emit_shortcut(app, "analyze-chat", None);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            enable_content_protection,
            toggle_main_window,
            capture_screen_png,
            start_meeting_capture,
            stop_meeting_capture,
            meeting_capture_status,
            ack_speech_segment
        ])
        .setup(move |app| {
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
                strip_os_focus_chrome(&window);

                let win = window.clone();
                let _ = window.on_window_event(move |event| {
                    if matches!(
                        event,
                        tauri::WindowEvent::Focused(_) | tauri::WindowEvent::Resized(_)
                    ) {
                        strip_os_focus_chrome(&win);
                        let _ = win.set_always_on_top(true);
                    }
                });
            }

            let hide_show = Shortcut::new(Some(chord | Modifiers::SHIFT), Code::KeyA);
            let shortcuts = [
                hide_show,
                Shortcut::new(Some(chord), Code::KeyH),
                Shortcut::new(Some(chord), Code::KeyG),
                Shortcut::new(Some(chord), Code::Enter),
                Shortcut::new(Some(Modifiers::SHIFT), Code::ArrowUp),
                Shortcut::new(Some(Modifiers::SHIFT), Code::ArrowDown),
                Shortcut::new(Some(chord), Code::ArrowUp),
                Shortcut::new(Some(chord), Code::ArrowDown),
                Shortcut::new(Some(chord), Code::ArrowLeft),
                Shortcut::new(Some(chord), Code::ArrowRight),
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

#[cfg(target_os = "macos")]
#[macro_use]
extern crate objc;

mod plugins;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    command,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, Runtime,
};

/// App 重啟旗標：由 `request_app_restart` command 設定，
/// `RunEvent::Exit` handler 在 `_exit(0)` 前檢查並 spawn 新 process。
static RESTART_REQUESTED: AtomicBool = AtomicBool::new(false);

/// 設定 macOS 視窗為瀏海覆蓋層級（與 BoringNotch 相同）
#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
fn configure_macos_notch_window(window: &tauri::WebviewWindow) {
    match window.ns_window() {
        Ok(ns_ptr) => {
            let ns_win = ns_ptr as *mut objc::runtime::Object;
            unsafe {
                // 視窗層級: NSMainMenuWindowLevel(24) + 3 = 27
                let _: () = objc::msg_send![ns_win, setLevel: 27_i64];

                // collectionBehavior: 出現在所有桌面、桌面切換時不移動
                // canJoinAllSpaces(1) | stationary(16) | ignoresCycle(64) | fullScreenAuxiliary(256)
                let behavior: u64 = 1 | 16 | 64 | 256;
                let _: () = objc::msg_send![ns_win, setCollectionBehavior: behavior];

                // 防止視窗被拖動
                let _: () = objc::msg_send![ns_win, setMovable: false];
            }
            println!("[macos] Notch window configured: level=27");
        }
        Err(e) => {
            eprintln!("[macos] Failed to get NSWindow: {e}");
        }
    }
}

/// 設定 Windows 視窗為工作列覆蓋層級（對應 macOS 的 setLevel:27）
#[cfg(target_os = "windows")]
fn configure_windows_topmost_window(window: &tauri::WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, HWND_TOPMOST,
        SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WINDOW_EX_STYLE,
        WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    };

    match window.hwnd() {
        Ok(hwnd) => unsafe {
            // 讀取現有 extended style，加入 TOOLWINDOW + NOACTIVATE
            let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let new_ex_style = WINDOW_EX_STYLE(ex_style as u32)
                | WS_EX_TOOLWINDOW    // 不出現在 Alt+Tab / taskbar，出現在所有虛擬桌面
                | WS_EX_NOACTIVATE; // 點擊不搶焦點
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_ex_style.0 as isize);

            // HWND_TOPMOST: 視窗永遠在最上層（包括 taskbar 之上）
            let _ = SetWindowPos(
                hwnd,
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );

            println!("[windows] Topmost window configured: HWND_TOPMOST + WS_EX_TOOLWINDOW");
        },
        Err(e) => {
            eprintln!("[windows] Failed to get HWND: {}", e);
        }
    }
}

#[command]
fn request_app_restart<R: Runtime>(app: AppHandle<R>) {
    println!("[app] Restart requested via command");
    RESTART_REQUESTED.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[command]
fn debug_log(level: String, message: String) {
    match level.as_str() {
        "error" => eprintln!("[webview:ERROR] {message}"),
        "warn" => println!("[webview:WARN] {message}"),
        _ => println!("[webview] {message}"),
    }
}

#[command]
fn update_hotkey_config(
    app: tauri::AppHandle,
    trigger_key: plugins::hotkey_listener::TriggerKey,
    trigger_mode: plugins::hotkey_listener::TriggerMode,
) -> Result<(), String> {
    let state = app.state::<plugins::hotkey_listener::HotkeyListenerState>();
    println!(
        "[hotkey-listener] Config updated: key={trigger_key:?}, mode={trigger_mode:?}"
    );
    state.update_config(trigger_key, trigger_mode);
    Ok(())
}

/// HUD 視窗邏輯寬度（pixels），對應前端 CSS 470px
const HUD_WINDOW_WIDTH_LOGICAL: f64 = 470.0;

/// macOS: 取得滑鼠游標座標（logical points，原點在主螢幕左上角）
#[cfg(target_os = "macos")]
fn get_cursor_position() -> (f64, f64) {
    #[repr(C)]
    #[derive(Copy, Clone)]
    struct CGPoint {
        x: f64,
        y: f64,
    }

    // 不透明 C 型別
    enum CGEventRef {}
    type CFTypeRef = *const std::ffi::c_void;

    extern "C" {
        fn CGEventCreate(source: CFTypeRef) -> *const CGEventRef;
        fn CGEventGetLocation(event: *const CGEventRef) -> CGPoint;
        fn CFRelease(cf: CFTypeRef);
    }

    /// Scope guard 確保 CGEvent 物件一定被 CFRelease，即使 panic 也不洩漏
    struct CgEventGuard(*const CGEventRef);
    impl Drop for CgEventGuard {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    CFRelease(self.0 as CFTypeRef);
                }
            }
        }
    }

    unsafe {
        let event = CGEventCreate(std::ptr::null());
        if event.is_null() {
            eprintln!("[hud-tracking] CGEventCreate returned null");
            return (0.0, 0.0);
        }
        let _guard = CgEventGuard(event);
        let point = CGEventGetLocation(event);
        (point.x, point.y)
    }
}

/// Windows: 取得滑鼠游標座標（virtual screen 座標）
#[cfg(target_os = "windows")]
fn get_cursor_position() -> (f64, f64) {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

    let mut point = POINT::default();
    unsafe {
        if let Err(e) = GetCursorPos(&mut point) {
            eprintln!("[hud-tracking] GetCursorPos failed: {}", e);
        }
    }
    (point.x as f64, point.y as f64)
}

/// `get_hud_target_position` 回傳給前端的定位資訊（logical 座標）
///
/// 使用 logical 座標而非 physical，以繞過 tao `set_outer_position` 在
/// cross-DPI 環境下使用錯誤 scale_factor 轉換的 bug：
/// tao 用視窗「當前」螢幕的 sf 而非「目標」螢幕的 sf 來除。
#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HudTargetPosition {
    x: f64,
    y: f64,
    monitor_key: String,
}

/// 抽象化的螢幕資訊，用於 `find_monitor_for_cursor()` 純函式測試
#[derive(Clone, Debug)]
pub struct MonitorInfo {
    /// 螢幕左上角 physical position x
    pub position_x: i32,
    /// 螢幕左上角 physical position y
    pub position_y: i32,
    /// 螢幕 physical width
    pub width: u32,
    /// 螢幕 physical height
    pub height: u32,
    /// DPI scale factor
    pub scale_factor: f64,
}

/// 根據游標座標找到所在螢幕的 index
///
/// macOS: 游標座標是 logical pixels (points)，需將 monitor physical position
///        除以各自的 scale_factor 轉為 logical 後比對
/// Windows: 游標座標與 monitor physical position 在同一座標系統，直接比對
///
/// 若無螢幕精確匹配，fallback 到距離游標最近的螢幕（防禦 rounding 間隙）；
/// 空陣列回傳 None
pub fn find_monitor_for_cursor(
    cursor_x: f64,
    cursor_y: f64,
    monitors: &[MonitorInfo],
    is_macos: bool,
) -> Option<usize> {
    if monitors.is_empty() {
        return None;
    }

    let mut closest_idx = 0;
    let mut min_distance_sq = f64::MAX;

    for (i, monitor) in monitors.iter().enumerate() {
        let (left, top, right, bottom) = if is_macos {
            // macOS: convert physical to logical
            let sf = monitor.scale_factor;
            let l = monitor.position_x as f64 / sf;
            let t = monitor.position_y as f64 / sf;
            let r = l + monitor.width as f64 / sf;
            let b = t + monitor.height as f64 / sf;
            (l, t, r, b)
        } else {
            // Windows: use physical directly
            let l = monitor.position_x as f64;
            let t = monitor.position_y as f64;
            let r = l + monitor.width as f64;
            let b = t + monitor.height as f64;
            (l, t, r, b)
        };

        if cursor_x >= left && cursor_x < right && cursor_y >= top && cursor_y < bottom {
            return Some(i);
        }

        // 計算游標到螢幕中心的距離（用於 fallback）
        let center_x = (left + right) / 2.0;
        let center_y = (top + bottom) / 2.0;
        let dist_sq = (cursor_x - center_x).powi(2) + (cursor_y - center_y).powi(2);
        if dist_sq < min_distance_sq {
            min_distance_sq = dist_sq;
            closest_idx = i;
        }
    }
    // fallback: 找距離游標最近的螢幕中心，而非固定 index 0
    Some(closest_idx)
}

/// 計算視窗水平置中位置（像素座標）
/// 回傳 x 座標（已乘以 scale_factor），用於 PhysicalPosition
/// 僅供 `setup()` 啟動時定位使用（同螢幕 sf 正確）
pub fn calculate_centered_window_x(
    screen_width_physical: u32,
    scale_factor: f64,
    window_width_logical: f64,
) -> i32 {
    let screen_width_logical = screen_width_physical as f64 / scale_factor;
    let x_logical = (screen_width_logical - window_width_logical) / 2.0;
    (x_logical * scale_factor) as i32
}

/// 計算視窗水平置中的 logical x 偏移量
/// 供多螢幕定位使用，搭配 LogicalPosition 繞過 tao cross-DPI bug
pub fn calculate_centered_window_x_logical(
    screen_width_physical: u32,
    scale_factor: f64,
    window_width_logical: f64,
) -> f64 {
    let screen_width_logical = screen_width_physical as f64 / scale_factor;
    (screen_width_logical - window_width_logical) / 2.0
}

/// 取得 HUD 應定位到的目標螢幕 logical 座標
///
/// 流程：
/// 1. 取得游標座標（macOS: logical points / Windows: virtual screen）
/// 2. 列舉所有螢幕
/// 3. 找到游標所在螢幕
/// 4. 計算該螢幕頂部水平置中的 logical 座標
/// 5. 回傳 LogicalPosition + monitor key
///
/// 使用 logical 座標而非 physical，以繞過 tao `set_outer_position` 在
/// cross-DPI 環境下用「當前螢幕 sf」而非「目標螢幕 sf」轉換的 bug。
#[command]
fn get_hud_target_position(app: tauri::AppHandle) -> Result<HudTargetPosition, String> {
    let (cursor_x, cursor_y) = get_cursor_position();

    let monitors = app.available_monitors().map_err(|e| e.to_string())?;

    if monitors.is_empty() {
        return Err("No monitors found".to_string());
    }

    let monitor_infos: Vec<MonitorInfo> = monitors
        .iter()
        .map(|m| MonitorInfo {
            position_x: m.position().x,
            position_y: m.position().y,
            width: m.size().width,
            height: m.size().height,
            scale_factor: m.scale_factor(),
        })
        .collect();

    let is_macos = cfg!(target_os = "macos");

    // safe to unwrap: monitors is non-empty, so find_monitor_for_cursor always returns Some
    let idx = find_monitor_for_cursor(cursor_x, cursor_y, &monitor_infos, is_macos)
        .expect("monitors is non-empty");

    let matched_monitor = &monitor_infos[idx];
    let sf = matched_monitor.scale_factor;

    // 還原螢幕的 logical origin（macOS: physical / sf = NSScreen points）
    let monitor_logical_x = matched_monitor.position_x as f64 / sf;
    let monitor_logical_y = matched_monitor.position_y as f64 / sf;

    // 計算 HUD 在目標螢幕上的 logical 置中偏移
    let centered_x_logical =
        calculate_centered_window_x_logical(matched_monitor.width, sf, HUD_WINDOW_WIDTH_LOGICAL);

    let hud_x = monitor_logical_x + centered_x_logical;
    let hud_y = monitor_logical_y;
    let monitor_key = format!(
        "{},{}",
        matched_monitor.position_x, matched_monitor.position_y
    );

    Ok(HudTargetPosition {
        x: hud_x,
        y: hud_y,
        monitor_key,
    })
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main-window") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

const DEFAULT_SENTRY_RELEASE: &str = concat!("sayit@", env!("CARGO_PKG_VERSION"));

fn get_sentry_dsn() -> Option<&'static str> {
    option_env!("SENTRY_DSN")
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.starts_with("__"))
}

fn get_sentry_environment() -> &'static str {
    option_env!("SENTRY_ENVIRONMENT")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(if cfg!(debug_assertions) {
            "development"
        } else {
            "production"
        })
}

fn get_sentry_release() -> &'static str {
    option_env!("SENTRY_RELEASE")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_SENTRY_RELEASE)
}

fn is_sentry_enabled() -> bool {
    matches!(get_sentry_environment(), "production") && get_sentry_dsn().is_some()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _sentry_guard = if is_sentry_enabled() {
        let dsn = get_sentry_dsn().expect("SENTRY_DSN must exist when Sentry is enabled");
        Some(sentry::init((
            dsn,
            sentry::ClientOptions {
                release: Some(get_sentry_release().into()),
                environment: Some(get_sentry_environment().into()),
                send_default_pii: false,
                ..Default::default()
            },
        )))
    } else {
        None
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(plugins::hotkey_listener::init())
        .invoke_handler(tauri::generate_handler![
            debug_log,
            request_app_restart,
            update_hotkey_config,
            get_hud_target_position,
            plugins::audio_control::mute_system_audio,
            plugins::audio_control::restore_system_audio,
            plugins::clipboard_paste::capture_target_window,
            plugins::clipboard_paste::copy_to_clipboard,
            plugins::clipboard_paste::paste_text,
            plugins::hotkey_listener::check_accessibility_permission_command,
            plugins::hotkey_listener::open_accessibility_settings,
            plugins::hotkey_listener::reinitialize_hotkey_listener,
            plugins::hotkey_listener::reset_hotkey_state,
            plugins::hotkey_listener::start_hotkey_recording,
            plugins::hotkey_listener::cancel_hotkey_recording,
            plugins::keyboard_monitor::start_quality_monitor,
            plugins::keyboard_monitor::start_correction_monitor,
            plugins::text_field_reader::read_focused_text_field,
            plugins::text_field_reader::read_selected_text,
            plugins::audio_recorder::get_default_input_device_name,
            plugins::audio_recorder::list_audio_input_devices,
            plugins::audio_recorder::start_audio_preview,
            plugins::audio_recorder::stop_audio_preview,
            plugins::audio_recorder::start_recording,
            plugins::audio_recorder::stop_recording,
            plugins::audio_recorder::save_recording_file,
            plugins::audio_recorder::read_recording_file,
            plugins::audio_recorder::delete_all_recordings,
            plugins::audio_recorder::cleanup_old_recordings,
            plugins::transcription::transcribe_audio,
            plugins::transcription::retranscribe_from_file,
            plugins::transcription::test_whisper_connection,
            plugins::sound_feedback::play_start_sound,
            plugins::sound_feedback::play_stop_sound,
            plugins::sound_feedback::play_error_sound,
            plugins::sound_feedback::play_learned_sound
        ])
        .setup(|app| {
            // 初始化 keyboard monitor 狀態
            app.manage(plugins::keyboard_monitor::KeyboardMonitorState::new());
            // 初始化 audio control 狀態
            app.manage(plugins::audio_control::AudioControlState::new());
            // 初始化 clipboard focus 狀態（Windows 貼上前恢復焦點）
            app.manage(plugins::clipboard_paste::FocusState::new());
            // 初始化 audio recorder 狀態
            app.manage(plugins::audio_recorder::AudioRecorderState::new());
            // 初始化 audio preview 狀態（音量預覽）
            app.manage(plugins::audio_recorder::AudioPreviewState::new());
            // 初始化 transcription 狀態（共用 HTTP client）
            app.manage(plugins::transcription::TranscriptionState::new());

            let open_dashboard_item =
                MenuItem::with_id(app, "open-dashboard", "開啟 Dashboard", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit SayIt", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_dashboard_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(tauri::image::Image::from_bytes(include_bytes!(
                    "../icons/tray-icon.png"
                ))?)
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(true)
                .tooltip("SayIt")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open-dashboard" => {
                        show_main_window(app);
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "macos")]
                configure_macos_notch_window(&window);

                #[cfg(target_os = "windows")]
                configure_windows_topmost_window(&window);

                if let Ok(Some(monitor)) = window.current_monitor() {
                    let x = calculate_centered_window_x(
                        monitor.size().width,
                        monitor.scale_factor(),
                        HUD_WINDOW_WIDTH_LOGICAL,
                    );
                    let _ = window.set_position(tauri::PhysicalPosition::new(x, 0));
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main-window" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                    println!("[main-window] Close requested → hidden (not destroyed)");
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            match event {
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Reopen { .. } => {
                    show_main_window(app_handle);
                }
                tauri::RunEvent::Exit => {
                    println!("[app] Exit: starting graceful shutdown...");

                    // 1. 恢復系統音量（避免永久靜音）
                    if let Some(state) = app_handle.try_state::<plugins::audio_control::AudioControlState>() {
                        state.shutdown();
                    }
                    // 2. 停止音量預覽（在 cpal 錄音之前，避免兩者同時釋放裝置）
                    if let Some(state) = app_handle.try_state::<plugins::audio_recorder::AudioPreviewState>() {
                        state.shutdown();
                    }
                    // 3. 停止 cpal 錄音（join thread, drop AudioUnit）
                    if let Some(state) = app_handle.try_state::<plugins::audio_recorder::AudioRecorderState>() {
                        state.shutdown();
                    }
                    // 4. 取消 keyboard monitor CGEventTap
                    if let Some(state) = app_handle.try_state::<plugins::keyboard_monitor::KeyboardMonitorState>() {
                        state.shutdown();
                    }
                    // 5. 停止 hotkey listener CGEventTap
                    if let Some(state) = app_handle.try_state::<plugins::hotkey_listener::HotkeyListenerState>() {
                        state.shutdown();
                    }
                    // 6. 等待背景 thread 完成清理
                    std::thread::sleep(std::time::Duration::from_millis(200));

                    // 7. Flush Sentry 事件佇列（確保 shutdown 前的事件送出）
                    if let Some(client) = sentry::Hub::current().client() {
                        client.flush(Some(std::time::Duration::from_secs(2)));
                    }

                    // 8. 如果是 restart 請求，在 _exit(0) 前自行 spawn 新 process
                    //    （因為 _exit(0) 會截殺 Tauri 內建的 restart 邏輯）
                    if RESTART_REQUESTED.load(Ordering::SeqCst) {
                        match std::env::current_exe() {
                            Ok(exe_path) => {
                                println!("[app] Spawning new process for restart: {exe_path:?}");
                                match std::process::Command::new(&exe_path).spawn() {
                                    Ok(_) => println!("[app] New process spawned successfully"),
                                    Err(e) => eprintln!("[app] Failed to spawn new process: {e}"),
                                }
                            }
                            Err(e) => eprintln!("[app] Failed to get current exe path: {e}"),
                        }
                    }

                    println!("[app] Graceful shutdown complete");
                    extern "C" {
                        fn _exit(status: i32) -> !;
                    }
                    unsafe { _exit(0) }
                }
                _ => {}
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    // ============================================================
    // calculate_centered_window_x 測試
    // ============================================================

    #[test]
    fn test_centered_window_x_standard_1080p() {
        // 1920px 螢幕、scale_factor=1.0、視窗寬 400px
        // 期望 x = (1920 - 400) / 2 = 760
        let x = calculate_centered_window_x(1920, 1.0, 400.0);
        assert_eq!(x, 760);
    }

    #[test]
    fn test_centered_window_x_retina_display() {
        // Retina: physical=2560, scale=2.0 → logical=1280
        // x_logical = (1280 - 400) / 2 = 440
        // x_physical = 440 * 2.0 = 880
        let x = calculate_centered_window_x(2560, 2.0, 400.0);
        assert_eq!(x, 880);
    }

    #[test]
    fn test_centered_window_x_fractional_scale() {
        // 150% 縮放: physical=2880, scale=1.5 → logical=1920
        // x_logical = (1920 - 400) / 2 = 760
        // x_physical = 760 * 1.5 = 1140
        let x = calculate_centered_window_x(2880, 1.5, 400.0);
        assert_eq!(x, 1140);
    }

    #[test]
    fn test_centered_window_x_window_equals_screen() {
        // 視窗與螢幕同寬時，x 應為 0
        let x = calculate_centered_window_x(400, 1.0, 400.0);
        assert_eq!(x, 0);
    }

    #[test]
    fn test_centered_window_x_4k_display() {
        // 4K: physical=3840, scale=2.0 → logical=1920
        // x_logical = (1920 - 400) / 2 = 760
        // x_physical = 760 * 2.0 = 1520
        let x = calculate_centered_window_x(3840, 2.0, 400.0);
        assert_eq!(x, 1520);
    }

    // ============================================================
    // find_monitor_for_cursor 測試
    // ============================================================

    fn make_monitor(px: i32, py: i32, w: u32, h: u32, sf: f64) -> MonitorInfo {
        MonitorInfo {
            position_x: px,
            position_y: py,
            width: w,
            height: h,
            scale_factor: sf,
        }
    }

    #[test]
    fn test_find_monitor_single_monitor() {
        let monitors = vec![make_monitor(0, 0, 1920, 1080, 1.0)];
        // 游標在螢幕中央
        assert_eq!(
            find_monitor_for_cursor(960.0, 540.0, &monitors, false),
            Some(0)
        );
        // macOS 也一樣（scale 1.0）
        assert_eq!(
            find_monitor_for_cursor(960.0, 540.0, &monitors, true),
            Some(0)
        );
    }

    #[test]
    fn test_find_monitor_dual_horizontal() {
        // 雙螢幕水平排列: [0,0 1920x1080] [1920,0 1920x1080]
        let monitors = vec![
            make_monitor(0, 0, 1920, 1080, 1.0),
            make_monitor(1920, 0, 1920, 1080, 1.0),
        ];
        // 游標在右螢幕
        assert_eq!(
            find_monitor_for_cursor(2000.0, 500.0, &monitors, false),
            Some(1)
        );
        // 游標在左螢幕
        assert_eq!(
            find_monitor_for_cursor(100.0, 500.0, &monitors, false),
            Some(0)
        );
    }

    #[test]
    fn test_find_monitor_dual_vertical() {
        // 副螢幕在上方（y 為負值）
        let monitors = vec![
            make_monitor(0, 0, 1920, 1080, 1.0),     // 主螢幕
            make_monitor(0, -1080, 1920, 1080, 1.0), // 上方副螢幕
        ];
        // 游標在上方螢幕
        assert_eq!(
            find_monitor_for_cursor(960.0, -500.0, &monitors, false),
            Some(1)
        );
        // 游標在主螢幕
        assert_eq!(
            find_monitor_for_cursor(960.0, 500.0, &monitors, false),
            Some(0)
        );
    }

    #[test]
    fn test_find_monitor_dual_different_dpi_macos() {
        // macOS: Retina 2x (physical 2560x1600) + 外接 1080p 1x (physical 1920x1080)
        // Tauri monitor position 為 physical pixels，游標座標為 logical points。
        // Retina: physical (0,0) → logical (0,0), logical size 1280x800
        // 外接: physical (2560,0) → logical (2560,0), logical size 1920x1080
        // logical 座標存在間隙 (1280~2560)，因兩螢幕 scale factor 不同
        let monitors = vec![
            make_monitor(0, 0, 2560, 1600, 2.0),    // Retina 主螢幕
            make_monitor(2560, 0, 1920, 1080, 1.0), // 外接 1080p
        ];
        // 游標在 Retina 主螢幕（logical x=640, y=400）
        assert_eq!(
            find_monitor_for_cursor(640.0, 400.0, &monitors, true),
            Some(0)
        );
        // 游標在外接螢幕（logical x=3000, y=500）
        assert_eq!(
            find_monitor_for_cursor(3000.0, 500.0, &monitors, true),
            Some(1)
        );
    }

    #[test]
    fn test_find_monitor_cursor_at_boundary() {
        let monitors = vec![
            make_monitor(0, 0, 1920, 1080, 1.0),
            make_monitor(1920, 0, 1920, 1080, 1.0),
        ];
        // 游標恰好在右螢幕左邊界上（x=1920）
        assert_eq!(
            find_monitor_for_cursor(1920.0, 500.0, &monitors, false),
            Some(1)
        );
        // 游標恰好在左螢幕左上角（x=0, y=0）
        assert_eq!(find_monitor_for_cursor(0.0, 0.0, &monitors, false), Some(0));
    }

    #[test]
    fn test_find_monitor_cursor_negative_coords() {
        // 副螢幕在主螢幕左方（x 為負）
        let monitors = vec![
            make_monitor(0, 0, 1920, 1080, 1.0),
            make_monitor(-1920, 0, 1920, 1080, 1.0),
        ];
        // 游標在左方副螢幕
        assert_eq!(
            find_monitor_for_cursor(-500.0, 500.0, &monitors, false),
            Some(1)
        );
    }

    #[test]
    fn test_find_monitor_fallback() {
        // 游標座標不在任何螢幕內 → fallback 到 index 0
        let monitors = vec![make_monitor(0, 0, 1920, 1080, 1.0)];
        assert_eq!(
            find_monitor_for_cursor(5000.0, 5000.0, &monitors, false),
            Some(0)
        );
    }

    #[test]
    fn test_find_monitor_empty_monitors() {
        // 空螢幕列表 → None
        let monitors: Vec<MonitorInfo> = vec![];
        assert_eq!(
            find_monitor_for_cursor(960.0, 540.0, &monitors, false),
            None
        );
    }

    // ============================================================
    // portrait 螢幕 + mixed-DPI 測試
    // ============================================================

    #[test]
    fn test_find_monitor_three_screens_with_portrait_macos() {
        // 三螢幕: 左(1x landscape) + 中(2x Retina) + 右(1x portrait)
        // macOS: Tauri physical position = NSScreen_origin * 各自 sf
        //
        // 中 Retina: NSScreen origin (0,0), sf=2.0 → physical (0,0), size 2880x1800
        //   logical bounds: [0, 1440) x [0, 900)
        // 左: NSScreen origin (-1920,0), sf=1.0 → physical (-1920,0), size 1920x1080
        //   logical bounds: [-1920, 0) x [0, 1080)
        // 右 portrait: NSScreen origin (1440,0), sf=1.0 → physical (1440,0), size 1080x1920
        //   logical bounds: [1440, 2520) x [0, 1920)
        let monitors = vec![
            make_monitor(-1920, 0, 1920, 1080, 1.0), // 左
            make_monitor(0, 0, 2880, 1800, 2.0),     // 中 Retina
            make_monitor(1440, 0, 1080, 1920, 1.0),  // 右 portrait
        ];
        // 游標在左螢幕
        assert_eq!(
            find_monitor_for_cursor(-960.0, 540.0, &monitors, true),
            Some(0)
        );
        // 游標在中間 Retina 螢幕
        assert_eq!(
            find_monitor_for_cursor(720.0, 450.0, &monitors, true),
            Some(1)
        );
        // 游標在右 portrait 螢幕（中央）
        assert_eq!(
            find_monitor_for_cursor(1980.0, 960.0, &monitors, true),
            Some(2)
        );
        // 游標在右 portrait 螢幕下半部（超出 landscape 高度範圍）
        assert_eq!(
            find_monitor_for_cursor(1500.0, 1500.0, &monitors, true),
            Some(2)
        );
    }

    #[test]
    fn test_find_monitor_portrait_bottom_aligned_macos() {
        // 中(2x Retina) + 右(1x portrait, 底部對齊)
        // 中 Retina: logical size 1440x900, origin (0,0)
        // 右 portrait: logical size 1080x1920
        //   底部對齊時: portrait top 在中螢幕 top 上方
        //   NSScreen origin y = 900 - 1920 = -1020
        //   physical position = (1440 * 1.0, -1020 * 1.0) = (1440, -1020)
        let monitors = vec![
            make_monitor(0, 0, 2880, 1800, 2.0),        // 中 Retina
            make_monitor(1440, -1020, 1080, 1920, 1.0), // 右 portrait
        ];
        // 游標在右 portrait 上半部（y 為負值）
        assert_eq!(
            find_monitor_for_cursor(1980.0, -500.0, &monitors, true),
            Some(1)
        );
        // 游標在右 portrait 下半部
        assert_eq!(
            find_monitor_for_cursor(1980.0, 800.0, &monitors, true),
            Some(1)
        );
        // 游標在中 Retina
        assert_eq!(
            find_monitor_for_cursor(720.0, 450.0, &monitors, true),
            Some(0)
        );
    }

    #[test]
    fn test_find_monitor_closest_fallback() {
        // 游標落在兩螢幕間的 rounding 間隙 → fallback 到最近螢幕
        let monitors = vec![
            make_monitor(0, 0, 1920, 1080, 1.0),
            make_monitor(3840, 0, 1920, 1080, 1.0), // 隔了一段距離
        ];
        // 游標在兩螢幕之間但靠近右螢幕
        assert_eq!(
            find_monitor_for_cursor(3500.0, 540.0, &monitors, false),
            Some(1)
        );
        // 游標在兩螢幕之間但靠近左螢幕
        assert_eq!(
            find_monitor_for_cursor(2000.0, 540.0, &monitors, false),
            Some(0)
        );
    }

    // ============================================================
    // calculate_centered_window_x_logical 測試
    // ============================================================

    #[test]
    fn test_centered_window_x_logical_portrait() {
        // portrait 螢幕: physical width=1080, scale=1.0
        // logical width = 1080, 置中偏移 = (1080 - 400) / 2 = 340
        let x = calculate_centered_window_x_logical(1080, 1.0, 400.0);
        assert!((x - 340.0).abs() < 0.001);
    }

    #[test]
    fn test_centered_window_x_logical_retina() {
        // Retina: physical=2880, scale=2.0 → logical=1440
        // 置中偏移 = (1440 - 400) / 2 = 520
        let x = calculate_centered_window_x_logical(2880, 2.0, 400.0);
        assert!((x - 520.0).abs() < 0.001);
    }

    #[test]
    fn test_centered_window_x_logical_standard_1080p() {
        // 1080p: physical=1920, scale=1.0 → logical=1920
        // 置中偏移 = (1920 - 400) / 2 = 760
        let x = calculate_centered_window_x_logical(1920, 1.0, 400.0);
        assert!((x - 760.0).abs() < 0.001);
    }
}

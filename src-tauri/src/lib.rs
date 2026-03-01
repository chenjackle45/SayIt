#[cfg(target_os = "macos")]
#[macro_use]
extern crate objc;

mod plugins;

use tauri::{
    command,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

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
            eprintln!("[macos] Failed to get NSWindow: {}", e);
        }
    }
}

/// 設定 Windows 視窗為工作列覆蓋層級（對應 macOS 的 setLevel:27）
#[cfg(target_os = "windows")]
fn configure_windows_topmost_window(window: &tauri::WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos,
        GWL_EXSTYLE, HWND_TOPMOST,
        SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WINDOW_EX_STYLE,
    };

    match window.hwnd() {
        Ok(hwnd) => unsafe {
            // 讀取現有 extended style，加入 TOOLWINDOW + NOACTIVATE
            let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let new_ex_style = WINDOW_EX_STYLE(ex_style as u32)
                | WS_EX_TOOLWINDOW    // 不出現在 Alt+Tab / taskbar，出現在所有虛擬桌面
                | WS_EX_NOACTIVATE;   // 點擊不搶焦點
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_ex_style.0 as isize);

            // HWND_TOPMOST: 視窗永遠在最上層（包括 taskbar 之上）
            let _ = SetWindowPos(
                hwnd,
                Some(HWND_TOPMOST),
                0, 0, 0, 0,
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
fn debug_log(level: String, message: String) {
    match level.as_str() {
        "error" => eprintln!("[webview:ERROR] {}", message),
        "warn" => println!("[webview:WARN] {}", message),
        _ => println!("[webview] {}", message),
    }
}

/// 計算視窗水平置中位置（像素座標）
/// 回傳 x 座標（已乘以 scale_factor），用於 PhysicalPosition
pub fn calculate_centered_window_x(
    screen_width_physical: u32,
    scale_factor: f64,
    window_width_logical: f64,
) -> i32 {
    let screen_width_logical = screen_width_physical as f64 / scale_factor;
    let x_logical = (screen_width_logical - window_width_logical) / 2.0;
    (x_logical * scale_factor) as i32
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(plugins::fn_key_listener::init())
        .invoke_handler(tauri::generate_handler![
            debug_log,
            plugins::clipboard_paste::paste_text
        ])
        .setup(|app| {
            let quit_item = MenuItem::with_id(app, "quit", "Quit SayIt", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit_item])?;

            TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("SayIt")
                .on_menu_event(|app, event| match event.id.as_ref() {
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

                if let Ok(monitor) = window.current_monitor() {
                    if let Some(monitor) = monitor {
                        let window_width = 400.0;
                        let x = calculate_centered_window_x(
                            monitor.size().width,
                            monitor.scale_factor(),
                            window_width,
                        );
                        let _ = window.set_position(tauri::PhysicalPosition::new(x, 0));
                    }
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
}

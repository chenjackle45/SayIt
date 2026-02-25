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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(plugins::fn_key_listener::init())
        .invoke_handler(tauri::generate_handler![
            debug_log,
            plugins::clipboard_paste::paste_text
        ])
        .setup(|app| {
            let quit_item = MenuItem::with_id(app, "quit", "Quit NoWayLM Voice", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit_item])?;

            TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("NoWayLM Voice")
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
                        let screen_width = monitor.size().width as f64 / monitor.scale_factor();
                        let window_width = 400.0;
                        let x = (screen_width - window_width) / 2.0;
                        let _ = window.set_position(tauri::PhysicalPosition::new(
                            (x * monitor.scale_factor()) as i32,
                            0,
                        ));
                    }
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

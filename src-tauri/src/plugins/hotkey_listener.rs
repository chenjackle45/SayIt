use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Emitter, Manager, Runtime,
};

// ========== Public Types ==========

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TriggerKey {
    // macOS keys (keycode)
    Fn,      // 63
    Option,  // 58
    Command, // 55
    // Windows keys (VK code)
    RightAlt, // VK_RMENU (0xA5)
    LeftAlt,  // VK_LMENU (0xA4)
    // Cross-platform
    Control, // macOS: 59, Windows: VK_LCONTROL (0xA2)
    Shift,   // macOS: 56, Windows: VK_LSHIFT (0xA0)
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TriggerMode {
    Hold,
    Toggle,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
enum HotkeyAction {
    Start,
    Stop,
}

#[derive(Serialize, Clone)]
struct HotkeyEventPayload {
    mode: TriggerMode,
    action: HotkeyAction,
}

pub struct HotkeyListenerState {
    trigger_key: Arc<Mutex<TriggerKey>>,
    trigger_mode: Arc<Mutex<TriggerMode>>,
    is_pressed: Arc<AtomicBool>,
    is_toggled_on: Arc<AtomicBool>,
}

impl Clone for HotkeyListenerState {
    fn clone(&self) -> Self {
        Self {
            trigger_key: self.trigger_key.clone(),
            trigger_mode: self.trigger_mode.clone(),
            is_pressed: self.is_pressed.clone(),
            is_toggled_on: self.is_toggled_on.clone(),
        }
    }
}

impl HotkeyListenerState {
    pub fn update_config(&self, key: TriggerKey, mode: TriggerMode) {
        *self.trigger_key.lock().unwrap() = key;
        *self.trigger_mode.lock().unwrap() = mode;
        self.is_pressed.store(false, Ordering::SeqCst);
        self.is_toggled_on.store(false, Ordering::SeqCst);
    }
}

// ========== Event Handling ==========

fn handle_key_event<R: Runtime>(
    app_handle: &AppHandle<R>,
    pressed: bool,
    state: &HotkeyListenerState,
) {
    let mode = state.trigger_mode.lock().unwrap().clone();
    match mode {
        TriggerMode::Hold => {
            if pressed {
                if !state.is_pressed.swap(true, Ordering::SeqCst) {
                    println!("[hotkey-listener] Hold: key pressed → start");
                    let _ = app_handle.emit(
                        "hotkey:pressed",
                        HotkeyEventPayload {
                            mode: TriggerMode::Hold,
                            action: HotkeyAction::Start,
                        },
                    );
                }
            } else if state.is_pressed.swap(false, Ordering::SeqCst) {
                println!("[hotkey-listener] Hold: key released → stop");
                let _ = app_handle.emit(
                    "hotkey:released",
                    HotkeyEventPayload {
                        mode: TriggerMode::Hold,
                        action: HotkeyAction::Stop,
                    },
                );
            }
        }
        TriggerMode::Toggle => {
            if pressed && !state.is_pressed.swap(true, Ordering::SeqCst) {
                let was_on = state.is_toggled_on.fetch_xor(true, Ordering::SeqCst);
                let action = if was_on {
                    HotkeyAction::Stop
                } else {
                    HotkeyAction::Start
                };
                println!("[hotkey-listener] Toggle: toggled → {:?}", action);
                let _ = app_handle.emit(
                    "hotkey:toggled",
                    HotkeyEventPayload {
                        mode: TriggerMode::Toggle,
                        action,
                    },
                );
            } else if !pressed {
                state.is_pressed.store(false, Ordering::SeqCst);
            }
        }
    }
}

// ========== macOS Implementation ==========

#[cfg(target_os = "macos")]
use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
#[cfg(target_os = "macos")]
use core_graphics::event::{
    CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement,
    CGEventType,
};

#[cfg(target_os = "macos")]
mod macos_keycodes {
    pub const FN: u16 = 63;
    pub const OPTION_L: u16 = 58;
    pub const CONTROL_L: u16 = 59;
    pub const COMMAND_L: u16 = 55;
    pub const SHIFT_L: u16 = 56;
}

#[cfg(target_os = "macos")]
fn check_accessibility_permission() -> bool {
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
    }
    let trusted = unsafe { AXIsProcessTrusted() };
    println!("[hotkey-listener] AXIsProcessTrusted = {}", trusted);
    trusted
}

#[tauri::command]
pub fn check_accessibility_permission_command() -> bool {
    #[cfg(target_os = "macos")]
    {
        return check_accessibility_permission();
    }

    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

#[tauri::command]
pub fn open_accessibility_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
            )
            .spawn()
            .map_err(|err| err.to_string())?;
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn prompt_accessibility_permission() {
    use core_foundation::base::TCFType;
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::string::CFString;
    use std::ffi::c_void;

    extern "C" {
        fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
    }

    let key = CFString::new("AXTrustedCheckOptionPrompt");
    let value = CFBoolean::true_value();
    let options = CFDictionary::from_CFType_pairs(&[(key, value)]);

    unsafe {
        AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef() as *const c_void);
    }
}

/// Match macOS keycode to configured trigger key
#[cfg(target_os = "macos")]
fn matches_trigger_key_macos(keycode: u16, trigger_key: &TriggerKey) -> bool {
    match trigger_key {
        TriggerKey::Fn => keycode == macos_keycodes::FN,
        TriggerKey::Option => keycode == macos_keycodes::OPTION_L,
        TriggerKey::Control => keycode == macos_keycodes::CONTROL_L,
        TriggerKey::Command => keycode == macos_keycodes::COMMAND_L,
        TriggerKey::Shift => keycode == macos_keycodes::SHIFT_L,
        _ => false, // Windows-only keys
    }
}

/// Determine press/release state from CGEventFlags for a modifier key
#[cfg(target_os = "macos")]
fn is_modifier_pressed(flags: CGEventFlags, trigger_key: &TriggerKey) -> Option<bool> {
    match trigger_key {
        TriggerKey::Fn => Some(flags.contains(CGEventFlags::CGEventFlagSecondaryFn)),
        TriggerKey::Option => Some(flags.contains(CGEventFlags::CGEventFlagAlternate)),
        TriggerKey::Control => Some(flags.contains(CGEventFlags::CGEventFlagControl)),
        TriggerKey::Command => Some(flags.contains(CGEventFlags::CGEventFlagCommand)),
        TriggerKey::Shift => Some(flags.contains(CGEventFlags::CGEventFlagShift)),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
fn start_event_tap<R: Runtime>(app_handle: AppHandle<R>, state: HotkeyListenerState) {
    std::thread::spawn(move || {
        println!("[hotkey-listener] Creating CGEventTap on thread...");

        // Clone app_handle for error handling (the original is moved into the closure)
        let app_handle_error = app_handle.clone();

        let tap_result = CGEventTap::new(
            CGEventTapLocation::Session,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly,
            vec![
                CGEventType::FlagsChanged,
                CGEventType::KeyDown,
                CGEventType::KeyUp,
            ],
            move |_proxy, event_type, event| {
                let keycode = event.get_integer_value_field(
                    core_graphics::event::EventField::KEYBOARD_EVENT_KEYCODE,
                ) as u16;

                let trigger = state.trigger_key.lock().unwrap().clone();

                match event_type {
                    CGEventType::FlagsChanged => {
                        let flags = event.get_flags();

                        if trigger == TriggerKey::Fn {
                            // Fn key: dual-detection strategy (keycode 63 + SecondaryFn flag)
                            let was_pressed = state.is_pressed.load(Ordering::SeqCst);
                            let fn_flag =
                                flags.contains(CGEventFlags::CGEventFlagSecondaryFn);

                            if keycode == macos_keycodes::FN {
                                // Keycode 63: toggle-based detection
                                handle_key_event(
                                    &app_handle,
                                    !was_pressed,
                                    &state,
                                );
                            } else if fn_flag && !was_pressed {
                                // Flag appeared without keycode 63
                                handle_key_event(
                                    &app_handle,
                                    true,
                                    &state,
                                );
                            } else if !fn_flag && was_pressed {
                                // Flag disappeared without keycode 63
                                handle_key_event(
                                    &app_handle,
                                    false,
                                    &state,
                                );
                            }
                        } else if matches_trigger_key_macos(keycode, &trigger) {
                            // Other modifier keys: flag-based press/release detection
                            if let Some(pressed) = is_modifier_pressed(flags, &trigger) {
                                handle_key_event(
                                    &app_handle,
                                    pressed,
                                    &state,
                                );
                            }
                        }
                    }
                    CGEventType::KeyDown => {
                        // Fallback for Fn key only (other modifiers don't fire KeyDown)
                        if trigger == TriggerKey::Fn && keycode == macos_keycodes::FN {
                            handle_key_event(
                                &app_handle,
                                true,
                                &state,
                            );
                        }
                    }
                    CGEventType::KeyUp => {
                        // Fallback for Fn key only
                        if trigger == TriggerKey::Fn && keycode == macos_keycodes::FN {
                            handle_key_event(
                                &app_handle,
                                false,
                                &state,
                            );
                        }
                    }
                    _ => {}
                }

                None
            },
        );

        match tap_result {
            Ok(tap) => {
                println!("[hotkey-listener] CGEventTap created successfully");
                unsafe {
                    let loop_source = tap
                        .mach_port
                        .create_runloop_source(0)
                        .expect("Failed to create runloop source");
                    let run_loop = CFRunLoop::get_current();
                    run_loop.add_source(&loop_source, kCFRunLoopCommonModes);
                    tap.enable();
                    println!(
                        "[hotkey-listener] RunLoop started, listening for hotkey events..."
                    );
                    CFRunLoop::run_current();
                }
            }
            Err(()) => {
                eprintln!("[hotkey-listener] ERROR: Failed to create CGEventTap!");
                eprintln!(
                    "[hotkey-listener] Go to System Settings > Privacy & Security > Accessibility"
                );
                eprintln!("[hotkey-listener] and add this application.");
                let _ = app_handle_error.emit(
                    "hotkey:error",
                    serde_json::json!({
                        "error": "accessibility_permission",
                        "message": "CGEventTap creation failed. Grant Accessibility permission."
                    }),
                );
            }
        }
    });
}

// ========== Windows Implementation ==========

#[cfg(target_os = "windows")]
mod windows_hook {
    use super::*;
    use std::sync::OnceLock;

    // Windows VK codes
    const VK_LSHIFT: u32 = 0xA0;
    const VK_LCONTROL: u32 = 0xA2;
    const VK_LMENU: u32 = 0xA4;
    const VK_RMENU: u32 = 0xA5;

    // Windows message constants
    const WM_KEYDOWN: u32 = 0x0100;
    const WM_KEYUP: u32 = 0x0101;
    const WM_SYSKEYDOWN: u32 = 0x0104;
    const WM_SYSKEYUP: u32 = 0x0105;

    struct HookContext {
        trigger_key: Arc<Mutex<TriggerKey>>,
        key_handler: Box<dyn Fn(bool) + Send + Sync>,
    }

    static CONTEXT: OnceLock<HookContext> = OnceLock::new();

    pub fn install<R: Runtime>(app_handle: AppHandle<R>, state: HotkeyListenerState) {
        let trigger_key_for_hook = state.trigger_key.clone();
        let app_handle_error = app_handle.clone();
        CONTEXT
            .set(HookContext {
                trigger_key: trigger_key_for_hook,
                key_handler: Box::new(move |pressed| {
                    handle_key_event(&app_handle, pressed, &state);
                }),
            })
            .ok();

        std::thread::spawn(move || unsafe {
            use windows::Win32::Foundation::*;
            use windows::Win32::UI::WindowsAndMessaging::*;

            match SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), None, 0) {
                Ok(hook) => {
                    println!("[hotkey-listener] Windows keyboard hook installed");
                    let mut msg = MSG::default();
                    while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                        let _ = TranslateMessage(&msg);
                        DispatchMessageW(&msg);
                    }
                    let _ = UnhookWindowsHookEx(hook);
                }
                Err(e) => {
                    eprintln!(
                        "[hotkey-listener] ERROR: Failed to install keyboard hook: {}",
                        e
                    );
                    let _ = app_handle_error.emit(
                        "hotkey:error",
                        serde_json::json!({
                            "error": "hook_install_failed",
                            "message": format!("Failed to install keyboard hook: {}", e)
                        }),
                    );
                }
            }
        });
    }

    unsafe extern "system" fn hook_proc(
        n_code: i32,
        w_param: windows::Win32::Foundation::WPARAM,
        l_param: windows::Win32::Foundation::LPARAM,
    ) -> windows::Win32::Foundation::LRESULT {
        use windows::Win32::UI::WindowsAndMessaging::*;

        if n_code >= 0 {
            if let Some(ctx) = CONTEXT.get() {
                let kbd = *(l_param.0 as *const KBDLLHOOKSTRUCT);
                let w = w_param.0 as u32;

                let is_key_down = w == WM_KEYDOWN || w == WM_SYSKEYDOWN;
                let is_key_up = w == WM_KEYUP || w == WM_SYSKEYUP;

                if is_key_down || is_key_up {
                    let trigger = match ctx.trigger_key.try_lock() {
                        Ok(guard) => guard.clone(),
                        Err(_) => return CallNextHookEx(None, n_code, w_param, l_param),
                    };
                    let matches = match trigger {
                        TriggerKey::RightAlt => kbd.vkCode == VK_RMENU,
                        TriggerKey::LeftAlt => kbd.vkCode == VK_LMENU,
                        TriggerKey::Control => kbd.vkCode == VK_LCONTROL,
                        TriggerKey::Shift => kbd.vkCode == VK_LSHIFT,
                        _ => false, // macOS-only keys
                    };

                    if matches {
                        (ctx.key_handler)(is_key_down);
                    }
                }
            }
        }

        CallNextHookEx(None, n_code, w_param, l_param)
    }
}

// ========== Plugin Init ==========

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("hotkey-listener")
        .setup(move |app, _api| {
            // Platform-specific default trigger key
            #[cfg(target_os = "macos")]
            let default_key = TriggerKey::Fn;
            #[cfg(target_os = "windows")]
            let default_key = TriggerKey::RightAlt;
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            let default_key = TriggerKey::Control;

            let state = HotkeyListenerState {
                trigger_key: Arc::new(Mutex::new(default_key)),
                trigger_mode: Arc::new(Mutex::new(TriggerMode::Hold)),
                is_pressed: Arc::new(AtomicBool::new(false)),
                is_toggled_on: Arc::new(AtomicBool::new(false)),
            };

            // Clone state for the hook thread (cheap Arc clones)
            let hook_state = state.clone();

            // Register state for Tauri commands to access
            app.manage(state);

            #[cfg(target_os = "macos")]
            {
                let trusted = check_accessibility_permission();
                if !trusted {
                    println!("[hotkey-listener] Prompting for Accessibility permission...");
                    prompt_accessibility_permission();
                    std::thread::sleep(std::time::Duration::from_secs(1));
                    let trusted_after = check_accessibility_permission();
                    if !trusted_after {
                        println!(
                            "[hotkey-listener] WARNING: Still no Accessibility permission."
                        );
                    }
                }
                start_event_tap(app.clone(), hook_state);
            }

            #[cfg(target_os = "windows")]
            {
                windows_hook::install(app.clone(), hook_state);
            }

            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            {
                let _ = hook_state; // suppress unused warning
                println!(
                    "[hotkey-listener] Hotkey listener is only supported on macOS and Windows."
                );
            }

            Ok(())
        })
        .build()
}

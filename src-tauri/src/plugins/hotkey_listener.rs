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
    Fn,          // 63
    Option,      // 58 (left)
    RightOption, // 61
    Command,     // 55
    // Windows keys (VK code)
    RightAlt, // VK_RMENU (0xA5)
    LeftAlt,  // VK_LMENU (0xA4)
    // Cross-platform
    Control,      // macOS: 59 (left), Windows: VK_LCONTROL (0xA2)
    RightControl, // macOS: 62
    Shift,        // macOS: 56, Windows: VK_LSHIFT (0xA0)
    // User-defined key (keycode is platform-specific: macOS CGEvent keycode / Windows VK code)
    Custom { keycode: u16 },
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
    #[cfg(target_os = "macos")]
    run_loop_ref: Arc<Mutex<Option<core_foundation::runloop::CFRunLoop>>>,
}

impl Clone for HotkeyListenerState {
    fn clone(&self) -> Self {
        Self {
            trigger_key: self.trigger_key.clone(),
            trigger_mode: self.trigger_mode.clone(),
            is_pressed: self.is_pressed.clone(),
            is_toggled_on: self.is_toggled_on.clone(),
            #[cfg(target_os = "macos")]
            run_loop_ref: self.run_loop_ref.clone(),
        }
    }
}

impl HotkeyListenerState {
    pub fn reset_key_states(&self) {
        self.is_pressed.store(false, Ordering::SeqCst);
        self.is_toggled_on.store(false, Ordering::SeqCst);
    }

    pub fn update_config(&self, key: TriggerKey, mode: TriggerMode) {
        *self.trigger_key.lock().unwrap() = key;
        *self.trigger_mode.lock().unwrap() = mode;
        self.reset_key_states();
    }

    #[cfg(target_os = "macos")]
    pub fn shutdown(&self) {
        stop_existing_event_tap(&self.run_loop_ref);
    }

    #[cfg(not(target_os = "macos"))]
    pub fn shutdown(&self) {}
}

// ========== Event Handling ==========

fn handle_key_event<R: Runtime>(
    app_handle: &AppHandle<R>,
    pressed: bool,
    state: &HotkeyListenerState,
) {
    // DEBUG: 追蹤每次呼叫
    println!(
        "🟡🟡🟡 [hotkey-listener] handle_key_event(pressed={}, is_pressed={}, is_toggled={})",
        pressed,
        state.is_pressed.load(Ordering::SeqCst),
        state.is_toggled_on.load(Ordering::SeqCst),
    );
    let mode = state.trigger_mode.lock().unwrap().clone();
    match mode {
        TriggerMode::Hold => {
            if pressed {
                if !state.is_pressed.swap(true, Ordering::SeqCst) {
                    println!("🟢🟢🟢 [hotkey-listener] EMIT hotkey:pressed");
                    let _ = app_handle.emit(
                        "hotkey:pressed",
                        HotkeyEventPayload {
                            mode: TriggerMode::Hold,
                            action: HotkeyAction::Start,
                        },
                    );
                }
            } else if state.is_pressed.swap(false, Ordering::SeqCst) {
                println!("🟢🟢🟢 [hotkey-listener] EMIT hotkey:released");
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
    pub const OPTION_R: u16 = 61;
    pub const CONTROL_L: u16 = 59;
    pub const CONTROL_R: u16 = 62;
    pub const COMMAND_L: u16 = 55;
    pub const COMMAND_R: u16 = 54;
    pub const SHIFT_L: u16 = 56;
    pub const SHIFT_R: u16 = 60;
    pub const ESCAPE: u16 = 53;
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
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
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
        TriggerKey::RightOption => keycode == macos_keycodes::OPTION_R,
        TriggerKey::Control => keycode == macos_keycodes::CONTROL_L,
        TriggerKey::RightControl => keycode == macos_keycodes::CONTROL_R,
        TriggerKey::Command => keycode == macos_keycodes::COMMAND_L,
        TriggerKey::Shift => keycode == macos_keycodes::SHIFT_L,
        TriggerKey::Custom { keycode: custom_kc } => keycode == *custom_kc,
        _ => false, // Windows-only keys
    }
}

/// Determine press/release state from CGEventFlags for a modifier key
#[cfg(target_os = "macos")]
fn is_modifier_pressed(flags: CGEventFlags, trigger_key: &TriggerKey) -> Option<bool> {
    match trigger_key {
        TriggerKey::Fn => Some(flags.contains(CGEventFlags::CGEventFlagSecondaryFn)),
        TriggerKey::Option | TriggerKey::RightOption => {
            Some(flags.contains(CGEventFlags::CGEventFlagAlternate))
        }
        TriggerKey::Control | TriggerKey::RightControl => {
            Some(flags.contains(CGEventFlags::CGEventFlagControl))
        }
        TriggerKey::Command => Some(flags.contains(CGEventFlags::CGEventFlagCommand)),
        TriggerKey::Shift => Some(flags.contains(CGEventFlags::CGEventFlagShift)),
        TriggerKey::Custom { keycode } => {
            // If custom keycode is a known modifier, use flag-based detection
            // for more reliable press/release than toggle-based
            match *keycode {
                macos_keycodes::OPTION_L | macos_keycodes::OPTION_R => {
                    Some(flags.contains(CGEventFlags::CGEventFlagAlternate))
                }
                macos_keycodes::CONTROL_L | macos_keycodes::CONTROL_R => {
                    Some(flags.contains(CGEventFlags::CGEventFlagControl))
                }
                macos_keycodes::COMMAND_L | macos_keycodes::COMMAND_R => {
                    Some(flags.contains(CGEventFlags::CGEventFlagCommand))
                }
                macos_keycodes::SHIFT_L | macos_keycodes::SHIFT_R => {
                    Some(flags.contains(CGEventFlags::CGEventFlagShift))
                }
                macos_keycodes::FN => Some(flags.contains(CGEventFlags::CGEventFlagSecondaryFn)),
                _ => None, // Non-modifier custom key: use keycode-based toggle
            }
        }
        _ => None,
    }
}

#[cfg(target_os = "macos")]
fn start_event_tap<R: Runtime>(app_handle: AppHandle<R>, state: HotkeyListenerState) {
    let run_loop_ref = state.run_loop_ref.clone();
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
                            let fn_flag = flags.contains(CGEventFlags::CGEventFlagSecondaryFn);

                            if keycode == macos_keycodes::FN {
                                // Keycode 63: toggle-based detection
                                handle_key_event(&app_handle, !was_pressed, &state);
                            } else if fn_flag && !was_pressed {
                                // Flag appeared without keycode 63
                                handle_key_event(&app_handle, true, &state);
                            } else if !fn_flag && was_pressed {
                                // Flag disappeared without keycode 63
                                handle_key_event(&app_handle, false, &state);
                            }
                        } else if let TriggerKey::Custom { keycode: custom_kc } = &trigger {
                            // Custom key as modifier in FlagsChanged
                            if keycode == *custom_kc {
                                // Prefer flag-based detection if this is a known modifier
                                if let Some(pressed) = is_modifier_pressed(flags, &trigger) {
                                    handle_key_event(&app_handle, pressed, &state);
                                } else {
                                    // Unknown modifier: fallback to toggle-based
                                    let was_pressed = state.is_pressed.load(Ordering::SeqCst);
                                    handle_key_event(&app_handle, !was_pressed, &state);
                                }
                            }
                        } else if matches_trigger_key_macos(keycode, &trigger) {
                            // Other modifier keys: flag-based press/release detection
                            if let Some(pressed) = is_modifier_pressed(flags, &trigger) {
                                handle_key_event(&app_handle, pressed, &state);
                            }
                        }
                    }
                    CGEventType::KeyDown => {
                        // ESC key detection (before trigger key matching)
                        if keycode == macos_keycodes::ESCAPE {
                            let _ = app_handle.emit("escape:pressed", ());
                            return None;
                        }

                        if trigger == TriggerKey::Fn && keycode == macos_keycodes::FN {
                            // Fallback for Fn key
                            handle_key_event(&app_handle, true, &state);
                        } else if let TriggerKey::Custom { keycode: custom_kc } = &trigger {
                            // Custom non-modifier key: KeyDown fires pressed
                            if keycode == *custom_kc {
                                handle_key_event(&app_handle, true, &state);
                            }
                        }
                    }
                    CGEventType::KeyUp => {
                        if trigger == TriggerKey::Fn && keycode == macos_keycodes::FN {
                            // Fallback for Fn key
                            handle_key_event(&app_handle, false, &state);
                        } else if let TriggerKey::Custom { keycode: custom_kc } = &trigger {
                            // Custom non-modifier key: KeyUp fires released
                            if keycode == *custom_kc {
                                handle_key_event(&app_handle, false, &state);
                            }
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
                    let current_run_loop = CFRunLoop::get_current();
                    current_run_loop.add_source(&loop_source, kCFRunLoopCommonModes);
                    tap.enable();
                    *run_loop_ref.lock().unwrap() = Some(current_run_loop);
                    println!("[hotkey-listener] RunLoop started, listening for hotkey events...");
                    CFRunLoop::run_current();
                    // RunLoop stopped (e.g. by reinitialize), clean up reference
                    *run_loop_ref.lock().unwrap() = None;
                    println!("[hotkey-listener] RunLoop stopped");
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

#[cfg(target_os = "macos")]
fn stop_existing_event_tap(run_loop_ref: &Arc<Mutex<Option<core_foundation::runloop::CFRunLoop>>>) {
    if let Some(ref rl) = *run_loop_ref.lock().unwrap() {
        rl.stop();
        println!("[hotkey-listener] Stopped existing CFRunLoop");
    }
}

#[tauri::command]
pub fn reset_hotkey_state(state: tauri::State<'_, HotkeyListenerState>) {
    state.reset_key_states();
    println!("[hotkey-listener] Key states reset via command");
}

#[tauri::command]
pub fn reinitialize_hotkey_listener<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if !check_accessibility_permission() {
            return Err("Accessibility permission not granted".to_string());
        }

        let state = app.state::<HotkeyListenerState>();

        // Stop existing event tap if running
        stop_existing_event_tap(&state.run_loop_ref);

        // Give CFRunLoopStop time to take effect
        std::thread::sleep(std::time::Duration::from_millis(200));

        // Reset key states
        state.reset_key_states();

        // Start new event tap
        let hook_state = state.inner().clone();
        start_event_tap(app, hook_state);

        println!("[hotkey-listener] Reinitialized hotkey listener");
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

// ========== Windows Implementation ==========

#[cfg(target_os = "windows")]
mod windows_hook {
    use super::*;
    use std::sync::OnceLock;

    // Windows VK codes
    const VK_LSHIFT: u32 = 0xA0;
    const VK_LCONTROL: u32 = 0xA2;
    const VK_RCONTROL: u32 = 0xA3;
    const VK_LMENU: u32 = 0xA4;
    const VK_RMENU: u32 = 0xA5;
    const VK_ESCAPE: u32 = 0x1B;

    // Windows message constants
    const WM_KEYDOWN: u32 = 0x0100;
    const WM_KEYUP: u32 = 0x0101;
    const WM_SYSKEYDOWN: u32 = 0x0104;
    const WM_SYSKEYUP: u32 = 0x0105;

    struct HookContext {
        trigger_key: Arc<Mutex<TriggerKey>>,
        key_handler: Box<dyn Fn(bool) + Send + Sync>,
        escape_handler: Box<dyn Fn() + Send + Sync>,
    }

    static CONTEXT: OnceLock<HookContext> = OnceLock::new();

    pub fn install<R: Runtime>(app_handle: AppHandle<R>, state: HotkeyListenerState) {
        let trigger_key_for_hook = state.trigger_key.clone();
        let app_handle_error = app_handle.clone();
        let app_handle_escape = app_handle.clone();
        CONTEXT
            .set(HookContext {
                trigger_key: trigger_key_for_hook,
                key_handler: Box::new(move |pressed| {
                    handle_key_event(&app_handle, pressed, &state);
                }),
                escape_handler: Box::new(move || {
                    let _ = app_handle_escape.emit("escape:pressed", ());
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
                    // ESC key detection (before trigger key matching)
                    if kbd.vkCode == VK_ESCAPE && is_key_down {
                        (ctx.escape_handler)();
                        return CallNextHookEx(None, n_code, w_param, l_param);
                    }

                    let trigger = match ctx.trigger_key.try_lock() {
                        Ok(guard) => guard.clone(),
                        Err(_) => return CallNextHookEx(None, n_code, w_param, l_param),
                    };
                    let matches = match trigger {
                        TriggerKey::RightAlt => kbd.vkCode == VK_RMENU,
                        TriggerKey::LeftAlt => kbd.vkCode == VK_LMENU,
                        TriggerKey::Control => kbd.vkCode == VK_LCONTROL,
                        TriggerKey::RightControl => kbd.vkCode == VK_RCONTROL,
                        TriggerKey::Shift => kbd.vkCode == VK_LSHIFT,
                        TriggerKey::Custom { keycode } => kbd.vkCode == keycode as u32,
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
                #[cfg(target_os = "macos")]
                run_loop_ref: Arc::new(Mutex::new(None)),
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
                        println!("[hotkey-listener] WARNING: Still no Accessibility permission.");
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

// ========== Tests ==========

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_custom_trigger_key_serde_serialize() {
        let key = TriggerKey::Custom { keycode: 96 };
        let value = serde_json::to_value(&key).unwrap();
        assert_eq!(value, json!({"custom": {"keycode": 96}}));
    }

    #[test]
    fn test_custom_trigger_key_serde_deserialize() {
        let json_val = json!({"custom": {"keycode": 96}});
        let key: TriggerKey = serde_json::from_value(json_val).unwrap();
        assert_eq!(key, TriggerKey::Custom { keycode: 96 });
    }

    #[test]
    fn test_preset_trigger_key_serde_roundtrip() {
        // Verify existing preset keys are not affected by the new Custom variant
        let key = TriggerKey::Fn;
        let serialized = serde_json::to_value(&key).unwrap();
        assert_eq!(serialized, json!("fn"));
        let deserialized: TriggerKey = serde_json::from_value(json!("fn")).unwrap();
        assert_eq!(deserialized, TriggerKey::Fn);
    }

    #[test]
    fn test_preset_trigger_key_backward_compat() {
        // All preset keys must still deserialize from plain strings
        let presets = vec![
            ("\"fn\"", TriggerKey::Fn),
            ("\"option\"", TriggerKey::Option),
            ("\"rightOption\"", TriggerKey::RightOption),
            ("\"command\"", TriggerKey::Command),
            ("\"rightAlt\"", TriggerKey::RightAlt),
            ("\"leftAlt\"", TriggerKey::LeftAlt),
            ("\"control\"", TriggerKey::Control),
            ("\"rightControl\"", TriggerKey::RightControl),
            ("\"shift\"", TriggerKey::Shift),
        ];
        for (json_str, expected) in presets {
            let deserialized: TriggerKey = serde_json::from_str(json_str).unwrap();
            assert_eq!(deserialized, expected, "Failed for {}", json_str);
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_matches_trigger_key_macos_custom() {
        let key = TriggerKey::Custom { keycode: 96 }; // F5 on macOS
        assert!(matches_trigger_key_macos(96, &key));
        assert!(!matches_trigger_key_macos(97, &key));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_escape_keycode_macos() {
        assert_eq!(macos_keycodes::ESCAPE, 53);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_escape_keycode_windows() {
        assert_eq!(windows_hook::VK_ESCAPE, 0x1B);
    }

    #[test]
    fn test_reset_key_states() {
        let state = HotkeyListenerState {
            trigger_key: Arc::new(Mutex::new(TriggerKey::Fn)),
            trigger_mode: Arc::new(Mutex::new(TriggerMode::Hold)),
            is_pressed: Arc::new(AtomicBool::new(true)),
            is_toggled_on: Arc::new(AtomicBool::new(true)),
            #[cfg(target_os = "macos")]
            run_loop_ref: Arc::new(Mutex::new(None)),
        };
        state.reset_key_states();
        assert!(!state.is_pressed.load(Ordering::SeqCst));
        assert!(!state.is_toggled_on.load(Ordering::SeqCst));
    }
}

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Emitter, Manager, Runtime,
};

// ========== Public Types ==========

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum ModifierFlag {
    Command,
    Control,
    Option,
    Shift,
    Fn,
}

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
    Custom {
        keycode: u16,
    },
    // Combo key: modifier(s) + primary key
    Combo {
        modifiers: Vec<ModifierFlag>,
        keycode: u16,
    },
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
#[serde(rename_all = "camelCase")]
struct HotkeyEventPayload {
    mode: TriggerMode,
    action: HotkeyAction,
}

// ========== Shared State ==========

struct DoubleTapState {
    last_release_time: Option<Instant>,
    last_hold_start: Option<Instant>,
}

impl DoubleTapState {
    fn new() -> Self {
        Self {
            last_release_time: None,
            last_hold_start: None,
        }
    }

    fn clear(&mut self) {
        self.last_release_time = None;
        self.last_hold_start = None;
    }
}

struct RecordingState {
    is_active: bool,
    accumulated_modifiers: HashSet<ModifierFlag>,
    last_modifier_keycode: Option<u16>,
}

impl RecordingState {
    fn new() -> Self {
        Self {
            is_active: false,
            accumulated_modifiers: HashSet::new(),
            last_modifier_keycode: None,
        }
    }

    fn reset(&mut self) {
        self.is_active = false;
        self.accumulated_modifiers.clear();
        self.last_modifier_keycode = None;
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct RecordingCapturedPayload {
    keycode: u16,
    modifiers: Vec<ModifierFlag>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct RecordingRejectedPayload {
    reason: String,
}

struct HotkeySharedState {
    trigger_key: TriggerKey,
    trigger_mode: TriggerMode,
    active_modifiers: HashSet<ModifierFlag>,
    double_tap: DoubleTapState,
    recording: RecordingState,
    toggle_long_press_fired: bool,
}

pub struct HotkeyListenerState {
    shared: Arc<Mutex<HotkeySharedState>>,
    is_pressed: Arc<AtomicBool>,
    is_toggled_on: Arc<AtomicBool>,
    #[cfg(target_os = "macos")]
    run_loop_ref: Arc<Mutex<Option<core_foundation::runloop::CFRunLoop>>>,
}

impl Clone for HotkeyListenerState {
    fn clone(&self) -> Self {
        Self {
            shared: self.shared.clone(),
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
        if let Ok(mut shared) = self.shared.lock() {
            shared.double_tap.clear();
            shared.active_modifiers.clear();
        }
    }

    pub fn update_config(&self, key: TriggerKey, mode: TriggerMode) {
        if let Ok(mut shared) = self.shared.lock() {
            shared.trigger_key = key;
            shared.trigger_mode = mode;
            shared.double_tap.clear();
            shared.active_modifiers.clear();
        }
        self.is_pressed.store(false, Ordering::SeqCst);
        self.is_toggled_on.store(false, Ordering::SeqCst);
    }

    #[cfg(target_os = "macos")]
    pub fn shutdown(&self) {
        stop_existing_event_tap(&self.run_loop_ref);
    }

    #[cfg(not(target_os = "macos"))]
    pub fn shutdown(&self) {}
}

// ========== Double-tap Detection ==========

const DOUBLE_TAP_MAX_HOLD_MS: u128 = 300;
const DOUBLE_TAP_MAX_GAP_MS: u128 = 350;
const TOGGLE_LONG_PRESS_MS: u128 = 1000;

/// Check if current press qualifies as double-tap (must be Hold mode).
fn check_double_tap(shared: &HotkeySharedState) -> bool {
    if shared.trigger_mode != TriggerMode::Hold {
        return false;
    }
    if let Some(last_release) = shared.double_tap.last_release_time {
        let gap = last_release.elapsed().as_millis();
        gap < DOUBLE_TAP_MAX_GAP_MS
    } else {
        false
    }
}

/// Record release timing for double-tap detection.
fn record_release_for_double_tap(shared: &mut HotkeySharedState) {
    if let Some(hold_start) = shared.double_tap.last_hold_start.take() {
        let hold_duration = hold_start.elapsed().as_millis();
        if hold_duration > DOUBLE_TAP_MAX_HOLD_MS {
            // Long hold — not a tap, reset
            shared.double_tap.last_release_time = None;
        } else {
            shared.double_tap.last_release_time = Some(Instant::now());
        }
    } else {
        shared.double_tap.last_release_time = None;
    }
}

// ========== Combo Matching ==========

fn matches_combo_trigger(
    keycode: u16,
    combo_modifiers: &[ModifierFlag],
    combo_keycode: u16,
    active_mods: &HashSet<ModifierFlag>,
) -> bool {
    // Combo requires at least one modifier — empty modifiers should use Custom variant
    if combo_modifiers.is_empty() {
        return false;
    }
    if keycode != combo_keycode {
        return false;
    }
    // ESC is reserved — never allow as combo primary key
    #[cfg(target_os = "macos")]
    if combo_keycode == 53 {
        return false;
    }
    #[cfg(target_os = "windows")]
    if combo_keycode == 0x1B {
        return false;
    }
    // Exact match: required modifiers must be held AND no extra modifiers
    combo_modifiers.len() == active_mods.len()
        && combo_modifiers.iter().all(|m| active_mods.contains(m))
}

// ========== Event Handling ==========

fn handle_key_event<R: Runtime>(
    app_handle: &AppHandle<R>,
    pressed: bool,
    state: &HotkeyListenerState,
    mode: &TriggerMode,
) {
    match mode {
        TriggerMode::Hold => {
            if pressed {
                // Record hold start for double-tap
                if let Ok(mut shared) = state.shared.lock() {
                    shared.double_tap.last_hold_start = Some(Instant::now());

                    // Check double-tap before emitting press
                    if check_double_tap(&shared) {
                        shared.double_tap.clear();
                        drop(shared);
                        println!("[hotkey-listener] double-tap detected, emitting mode-toggle");
                        let _ = app_handle.emit("hotkey:mode-toggle", ());
                        return;
                    }
                }

                if !state.is_pressed.swap(true, Ordering::SeqCst) {
                    let _ = app_handle.emit(
                        "hotkey:pressed",
                        HotkeyEventPayload {
                            mode: TriggerMode::Hold,
                            action: HotkeyAction::Start,
                        },
                    );
                }
            } else if state.is_pressed.swap(false, Ordering::SeqCst) {
                // Record release for double-tap
                if let Ok(mut shared) = state.shared.lock() {
                    record_release_for_double_tap(&mut shared);
                }

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
                // Reset long-press flag and spawn delayed thread for 1s detection
                if let Ok(mut shared) = state.shared.lock() {
                    shared.toggle_long_press_fired = false;
                }

                let is_pressed_clone = state.is_pressed.clone();
                let shared_clone = state.shared.clone();
                let app_handle_clone = app_handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(
                        TOGGLE_LONG_PRESS_MS as u64,
                    ));
                    // After 1s: if still pressed, fire mode-toggle
                    if is_pressed_clone.load(Ordering::SeqCst) {
                        if let Ok(mut shared) = shared_clone.lock() {
                            shared.toggle_long_press_fired = true;
                        }
                        println!(
                            "[hotkey-listener] toggle long-press detected, emitting mode-toggle"
                        );
                        let _ = app_handle_clone.emit("hotkey:mode-toggle", ());
                    }
                });
            } else if !pressed && state.is_pressed.swap(false, Ordering::SeqCst) {
                // On release: if long-press already fired, do nothing. Otherwise normal toggle.
                let was_long_press = state
                    .shared
                    .lock()
                    .map(|s| s.toggle_long_press_fired)
                    .unwrap_or(false);

                if !was_long_press {
                    // Short press → normal toggle
                    let was_on = state.is_toggled_on.fetch_xor(true, Ordering::SeqCst);
                    let action = if was_on {
                        HotkeyAction::Stop
                    } else {
                        HotkeyAction::Start
                    };
                    let _ = app_handle.emit(
                        "hotkey:toggled",
                        HotkeyEventPayload {
                            mode: TriggerMode::Toggle,
                            action,
                        },
                    );
                }
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

/// Match macOS keycode to configured trigger key (single keys only, not Combo)
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
        TriggerKey::Combo { .. } => false, // Combo matching handled separately
        _ => false,                        // Windows-only keys
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
        TriggerKey::Custom { keycode } => match *keycode {
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
            _ => None,
        },
        _ => None,
    }
}

/// Extract active modifier flags from CGEventFlags
#[cfg(target_os = "macos")]
fn extract_active_modifiers_macos(flags: CGEventFlags) -> HashSet<ModifierFlag> {
    let mut mods = HashSet::new();
    if flags.contains(CGEventFlags::CGEventFlagCommand) {
        mods.insert(ModifierFlag::Command);
    }
    if flags.contains(CGEventFlags::CGEventFlagControl) {
        mods.insert(ModifierFlag::Control);
    }
    if flags.contains(CGEventFlags::CGEventFlagAlternate) {
        mods.insert(ModifierFlag::Option);
    }
    if flags.contains(CGEventFlags::CGEventFlagShift) {
        mods.insert(ModifierFlag::Shift);
    }
    if flags.contains(CGEventFlags::CGEventFlagSecondaryFn) {
        mods.insert(ModifierFlag::Fn);
    }
    mods
}

/// Check if a macOS keycode represents a modifier key (for recording mode)
#[cfg(target_os = "macos")]
fn is_modifier_keycode_macos(keycode: u16) -> bool {
    matches!(
        keycode,
        macos_keycodes::COMMAND_L
            | macos_keycodes::COMMAND_R
            | macos_keycodes::SHIFT_L
            | macos_keycodes::SHIFT_R
            | macos_keycodes::CONTROL_L
            | macos_keycodes::CONTROL_R
            | macos_keycodes::OPTION_L
            | macos_keycodes::OPTION_R
            | macos_keycodes::FN
    )
}

/// Handle key events during recording mode (macOS).
/// Accumulates modifiers, captures primary key or single modifier, rejects ESC.
#[cfg(target_os = "macos")]
fn handle_recording_event_macos<R: Runtime>(
    app_handle: &AppHandle<R>,
    event_type: CGEventType,
    keycode: u16,
    flags: CGEventFlags,
    state: &HotkeyListenerState,
) {
    match event_type {
        CGEventType::FlagsChanged => {
            // Fn key (keycode 63): toggle-based detection.
            // First FlagsChanged with keycode 63 = Fn pressed → accumulate like a modifier.
            // Second FlagsChanged with keycode 63 = Fn released → if no primary key was pressed,
            // capture as single key.
            if keycode == macos_keycodes::FN {
                let mut shared = match state.shared.lock() {
                    Ok(g) => g,
                    Err(_) => return,
                };
                let fn_already_tracked = shared.recording.last_modifier_keycode
                    == Some(macos_keycodes::FN)
                    || shared
                        .recording
                        .accumulated_modifiers
                        .contains(&ModifierFlag::Fn);

                if !fn_already_tracked {
                    // Fn pressed (first toggle): accumulate as modifier, wait for primary key
                    shared
                        .recording
                        .accumulated_modifiers
                        .insert(ModifierFlag::Fn);
                    shared.recording.last_modifier_keycode = Some(macos_keycodes::FN);
                    println!("[hotkey-listener] recording: Fn pressed, accumulated as modifier");
                } else {
                    // Fn released (second toggle): no primary key was pressed → single Fn capture
                    shared.recording.reset();
                    drop(shared);
                    println!("[hotkey-listener] recording: captured Fn (single, toggle release)");
                    let _ = app_handle.emit(
                        "hotkey:recording-captured",
                        RecordingCapturedPayload {
                            keycode: macos_keycodes::FN,
                            modifiers: vec![],
                        },
                    );
                }
                return;
            }

            // Standard modifiers (Command, Control, Option, Shift)
            // Exclude Fn from flag-based detection — Fn is handled above via keycode toggle
            let mut current_mods = extract_active_modifiers_macos(flags);
            current_mods.remove(&ModifierFlag::Fn);

            let mut shared = match state.shared.lock() {
                Ok(g) => g,
                Err(_) => return,
            };

            if !current_mods.is_empty() {
                // Modifiers pressed: accumulate and track keycode
                shared.recording.accumulated_modifiers = current_mods;
                if is_modifier_keycode_macos(keycode) {
                    shared.recording.last_modifier_keycode = Some(keycode);
                }
            } else if shared.recording.last_modifier_keycode.is_some() {
                // All modifiers released without a primary key → single modifier capture
                let last_kc = shared.recording.last_modifier_keycode.unwrap();
                shared.recording.reset();
                drop(shared);
                println!(
                    "[hotkey-listener] recording: captured single modifier keycode={}",
                    last_kc
                );
                let _ = app_handle.emit(
                    "hotkey:recording-captured",
                    RecordingCapturedPayload {
                        keycode: last_kc,
                        modifiers: vec![],
                    },
                );
            }
        }
        CGEventType::KeyDown => {
            let mut shared = match state.shared.lock() {
                Ok(g) => g,
                Err(_) => return,
            };

            // ESC: reject (reserved key)
            if keycode == macos_keycodes::ESCAPE {
                shared.recording.reset();
                drop(shared);
                let _ = app_handle.emit(
                    "hotkey:recording-rejected",
                    RecordingRejectedPayload {
                        reason: "esc_reserved".to_string(),
                    },
                );
                return;
            }

            // Non-modifier key pressed: capture with accumulated modifiers
            let mods: Vec<ModifierFlag> = shared
                .recording
                .accumulated_modifiers
                .iter()
                .cloned()
                .collect();
            shared.recording.reset();
            drop(shared);
            println!(
                "[hotkey-listener] recording: captured keycode={}, modifiers={:?}",
                keycode, mods
            );
            let _ = app_handle.emit(
                "hotkey:recording-captured",
                RecordingCapturedPayload {
                    keycode,
                    modifiers: mods,
                },
            );
        }
        _ => {} // Ignore KeyUp during recording
    }
}

#[cfg(target_os = "macos")]
fn start_event_tap<R: Runtime>(app_handle: AppHandle<R>, state: HotkeyListenerState) {
    let run_loop_ref = state.run_loop_ref.clone();
    std::thread::spawn(move || {
        println!("[hotkey-listener] Creating CGEventTap on thread...");

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

                // Recording mode: delegate to recording handler, skip all trigger logic
                {
                    let is_recording = state
                        .shared
                        .lock()
                        .map(|s| s.recording.is_active)
                        .unwrap_or(false);
                    if is_recording {
                        handle_recording_event_macos(
                            &app_handle,
                            event_type,
                            keycode,
                            event.get_flags(),
                            &state,
                        );
                        return None;
                    }
                }

                // Single lock: read trigger config + update active modifiers + snapshot
                let (trigger, mode, active_mods_snapshot) = {
                    let mut shared = match state.shared.lock() {
                        Ok(g) => g,
                        Err(_) => return None,
                    };

                    // Update active modifiers on FlagsChanged (for combo matching)
                    if matches!(event_type, CGEventType::FlagsChanged) {
                        let flags = event.get_flags();
                        shared.active_modifiers = extract_active_modifiers_macos(flags);
                    }

                    let mods = shared.active_modifiers.clone();
                    (
                        shared.trigger_key.clone(),
                        shared.trigger_mode.clone(),
                        mods,
                    )
                };

                match event_type {
                    CGEventType::FlagsChanged => {
                        let flags = event.get_flags();

                        // Combo trigger: check if required modifiers disappeared → release
                        // Use active_mods_snapshot (already extracted in the single lock above)
                        if let TriggerKey::Combo { ref modifiers, .. } = trigger {
                            let all_held =
                                modifiers.iter().all(|m| active_mods_snapshot.contains(m));
                            let was_pressed = state.is_pressed.load(Ordering::SeqCst);
                            if !all_held && was_pressed {
                                // A required modifier was released → stop
                                handle_key_event(&app_handle, false, &state, &mode);
                            }
                            return None;
                        }

                        // Single-key triggers (existing logic)
                        if trigger == TriggerKey::Fn {
                            if keycode == macos_keycodes::FN {
                                let fn_flag = flags.contains(CGEventFlags::CGEventFlagSecondaryFn);
                                handle_key_event(&app_handle, fn_flag, &state, &mode);
                            }
                        } else if let TriggerKey::Custom { keycode: custom_kc } = &trigger {
                            if keycode == *custom_kc {
                                if let Some(pressed) = is_modifier_pressed(flags, &trigger) {
                                    handle_key_event(&app_handle, pressed, &state, &mode);
                                } else {
                                    let was_pressed = state.is_pressed.load(Ordering::SeqCst);
                                    handle_key_event(&app_handle, !was_pressed, &state, &mode);
                                }
                            }
                        } else if matches_trigger_key_macos(keycode, &trigger) {
                            if let Some(pressed) = is_modifier_pressed(flags, &trigger) {
                                handle_key_event(&app_handle, pressed, &state, &mode);
                            }
                        }
                    }
                    CGEventType::KeyDown => {
                        // ESC key: always emit, also clears double-tap state
                        if keycode == macos_keycodes::ESCAPE {
                            if let Ok(mut shared) = state.shared.lock() {
                                shared.double_tap.clear();
                            }
                            let _ = app_handle.emit("escape:pressed", ());
                            return None;
                        }

                        // Combo trigger: check primary key + modifiers (using snapshot from initial lock)
                        if let TriggerKey::Combo {
                            ref modifiers,
                            keycode: combo_kc,
                        } = trigger
                        {
                            if matches_combo_trigger(
                                keycode,
                                modifiers,
                                combo_kc,
                                &active_mods_snapshot,
                            ) {
                                handle_key_event(&app_handle, true, &state, &mode);
                            }
                            return None;
                        }

                        // Single-key triggers
                        if trigger == TriggerKey::Fn && keycode == macos_keycodes::FN {
                            handle_key_event(&app_handle, true, &state, &mode);
                        } else if let TriggerKey::Custom { keycode: custom_kc } = &trigger {
                            if keycode == *custom_kc {
                                handle_key_event(&app_handle, true, &state, &mode);
                            }
                        }
                    }
                    CGEventType::KeyUp => {
                        // Combo trigger: primary key released → stop
                        if let TriggerKey::Combo {
                            keycode: combo_kc, ..
                        } = &trigger
                        {
                            if keycode == *combo_kc {
                                handle_key_event(&app_handle, false, &state, &mode);
                            }
                            return None;
                        }

                        // Single-key triggers
                        if trigger == TriggerKey::Fn && keycode == macos_keycodes::FN {
                            handle_key_event(&app_handle, false, &state, &mode);
                        } else if let TriggerKey::Custom { keycode: custom_kc } = &trigger {
                            if keycode == *custom_kc {
                                handle_key_event(&app_handle, false, &state, &mode);
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
                    if let Ok(mut guard) = run_loop_ref.lock() {
                        *guard = Some(current_run_loop);
                    }
                    println!("[hotkey-listener] RunLoop started, listening for hotkey events...");
                    CFRunLoop::run_current();
                    if let Ok(mut guard) = run_loop_ref.lock() {
                        *guard = None;
                    }
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
    if let Ok(guard) = run_loop_ref.lock() {
        if let Some(ref rl) = *guard {
            rl.stop();
            println!("[hotkey-listener] Stopped existing CFRunLoop");
        }
    }
}

#[tauri::command]
pub fn reset_hotkey_state(state: tauri::State<'_, HotkeyListenerState>) {
    state.reset_key_states();
    println!("[hotkey-listener] Key states reset via command");
}

#[tauri::command]
pub fn start_hotkey_recording(state: tauri::State<'_, HotkeyListenerState>) {
    if let Ok(mut shared) = state.shared.lock() {
        shared.recording.reset();
        shared.recording.is_active = true;
    }
    state.is_pressed.store(false, Ordering::SeqCst);
    println!("[hotkey-listener] Recording mode started");
}

#[tauri::command]
pub fn cancel_hotkey_recording(state: tauri::State<'_, HotkeyListenerState>) {
    if let Ok(mut shared) = state.shared.lock() {
        shared.recording.reset();
    }
    println!("[hotkey-listener] Recording mode cancelled");
}

#[tauri::command]
pub fn reinitialize_hotkey_listener<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if !check_accessibility_permission() {
            return Err("Accessibility permission not granted".to_string());
        }

        let state = app.state::<HotkeyListenerState>();

        stop_existing_event_tap(&state.run_loop_ref);

        std::thread::sleep(std::time::Duration::from_millis(200));

        state.reset_key_states();

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
    const VK_F23: u32 = 0x86;

    // Windows modifier VK codes for combo detection
    const VK_LWIN: u32 = 0x5B;
    const VK_RWIN: u32 = 0x5C;

    // Windows message constants
    const WM_KEYDOWN: u32 = 0x0100;
    const WM_KEYUP: u32 = 0x0101;
    const WM_SYSKEYDOWN: u32 = 0x0104;
    const WM_SYSKEYUP: u32 = 0x0105;

    struct HookContext {
        shared: Arc<Mutex<HotkeySharedState>>,
        is_pressed: Arc<AtomicBool>,
        key_handler: Box<dyn Fn(bool, &TriggerMode) + Send + Sync>,
        escape_handler: Box<dyn Fn() + Send + Sync>,
        recording_captured_handler: Box<dyn Fn(RecordingCapturedPayload) + Send + Sync>,
        recording_rejected_handler: Box<dyn Fn(RecordingRejectedPayload) + Send + Sync>,
    }

    static CONTEXT: OnceLock<HookContext> = OnceLock::new();

    fn is_modifier_vk(vk: u32) -> bool {
        matches!(
            vk,
            VK_LSHIFT | 0xA1 | VK_LCONTROL | VK_RCONTROL | VK_LMENU | VK_RMENU | VK_LWIN | VK_RWIN
        )
    }

    fn handle_recording_event_windows(ctx: &HookContext, vk: u16, is_key_down: bool) {
        if is_key_down {
            // ESC: reject
            if vk as u32 == VK_ESCAPE {
                if let Ok(mut shared) = ctx.shared.try_lock() {
                    shared.recording.reset();
                }
                (ctx.recording_rejected_handler)(RecordingRejectedPayload {
                    reason: "esc_reserved".to_string(),
                });
                return;
            }

            if is_modifier_vk(vk as u32) {
                // Modifier pressed: accumulate
                if let Ok(mut shared) = ctx.shared.try_lock() {
                    let mods = unsafe { get_active_modifiers_windows() };
                    shared.recording.accumulated_modifiers = mods;
                    shared.recording.last_modifier_keycode = Some(vk);
                }
            } else {
                // Non-modifier key pressed: capture with accumulated modifiers
                let mods = if let Ok(mut shared) = ctx.shared.try_lock() {
                    let m: Vec<ModifierFlag> = shared
                        .recording
                        .accumulated_modifiers
                        .iter()
                        .cloned()
                        .collect();
                    shared.recording.reset();
                    m
                } else {
                    vec![]
                };
                (ctx.recording_captured_handler)(RecordingCapturedPayload {
                    keycode: vk,
                    modifiers: mods,
                });
            }
        } else {
            // Key up: check if modifier released and all modifiers gone
            if is_modifier_vk(vk as u32) {
                let all_released = unsafe { get_active_modifiers_windows().is_empty() };
                if all_released {
                    if let Ok(mut shared) = ctx.shared.try_lock() {
                        if let Some(last_kc) = shared.recording.last_modifier_keycode.take() {
                            shared.recording.reset();
                            drop(shared);
                            (ctx.recording_captured_handler)(RecordingCapturedPayload {
                                keycode: last_kc,
                                modifiers: vec![],
                            });
                        }
                    }
                }
            }
        }
    }

    /// Check if a Windows VK key is currently pressed via GetKeyState
    unsafe fn is_vk_pressed(vk: i32) -> bool {
        use windows::Win32::UI::Input::KeyboardAndMouse::GetKeyState;
        (GetKeyState(vk) & (0x8000u16 as i16)) != 0
    }

    /// Get active modifier flags using GetKeyState (Windows)
    unsafe fn get_active_modifiers_windows() -> HashSet<ModifierFlag> {
        let mut mods = HashSet::new();
        if is_vk_pressed(VK_LWIN as i32) || is_vk_pressed(VK_RWIN as i32) {
            mods.insert(ModifierFlag::Command);
        }
        if is_vk_pressed(VK_LCONTROL as i32) || is_vk_pressed(VK_RCONTROL as i32) {
            mods.insert(ModifierFlag::Control);
        }
        if is_vk_pressed(VK_LMENU as i32) || is_vk_pressed(VK_RMENU as i32) {
            mods.insert(ModifierFlag::Option);
        }
        if is_vk_pressed(VK_LSHIFT as i32) || is_vk_pressed(0xA1) {
            // 0xA1 = VK_RSHIFT
            mods.insert(ModifierFlag::Shift);
        }
        mods
    }

    pub fn install<R: Runtime>(app_handle: AppHandle<R>, state: HotkeyListenerState) {
        let shared_for_hook = state.shared.clone();
        let is_pressed_for_hook = state.is_pressed.clone();
        let app_handle_error = app_handle.clone();
        let app_handle_escape = app_handle.clone();
        let app_handle_rec_captured = app_handle.clone();
        let app_handle_rec_rejected = app_handle.clone();
        CONTEXT
            .set(HookContext {
                shared: shared_for_hook,
                is_pressed: is_pressed_for_hook,
                key_handler: Box::new(move |pressed, mode| {
                    handle_key_event(&app_handle, pressed, &state, mode);
                }),
                escape_handler: Box::new(move || {
                    let _ = app_handle_escape.emit("escape:pressed", ());
                }),
                recording_captured_handler: Box::new(move |payload| {
                    let _ = app_handle_rec_captured.emit("hotkey:recording-captured", payload);
                }),
                recording_rejected_handler: Box::new(move |payload| {
                    let _ = app_handle_rec_rejected.emit("hotkey:recording-rejected", payload);
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
                // Ignore Copilot's dedicated VK_F23 signal to avoid interfering with QuickFill.
                if kbd.vkCode == VK_F23 {
                    return CallNextHookEx(None, n_code, w_param, l_param);
                }
                let w = w_param.0 as u32;

                let is_key_down = w == WM_KEYDOWN || w == WM_SYSKEYDOWN;
                let is_key_up = w == WM_KEYUP || w == WM_SYSKEYUP;

                if is_key_down || is_key_up {
                    // Recording mode: delegate to recording handler, skip all trigger logic
                    let is_recording = ctx
                        .shared
                        .try_lock()
                        .map(|s| s.recording.is_active)
                        .unwrap_or(false);
                    if is_recording {
                        handle_recording_event_windows(ctx, kbd.vkCode as u16, is_key_down);
                        return CallNextHookEx(None, n_code, w_param, l_param);
                    }

                    // ESC key: clear double-tap state, emit escape
                    if kbd.vkCode == VK_ESCAPE && is_key_down {
                        if let Ok(mut shared) = ctx.shared.try_lock() {
                            shared.double_tap.clear();
                        }
                        (ctx.escape_handler)();
                        return CallNextHookEx(None, n_code, w_param, l_param);
                    }

                    let (trigger, mode, active_mods) = match ctx.shared.try_lock() {
                        Ok(mut shared) => {
                            // Update active modifiers
                            shared.active_modifiers = get_active_modifiers_windows();
                            let mods = shared.active_modifiers.clone();
                            (
                                shared.trigger_key.clone(),
                                shared.trigger_mode.clone(),
                                mods,
                            )
                        }
                        Err(_) => return CallNextHookEx(None, n_code, w_param, l_param),
                    };

                    // Combo trigger
                    if let TriggerKey::Combo {
                        ref modifiers,
                        keycode: combo_kc,
                    } = trigger
                    {
                        if kbd.vkCode == combo_kc as u32 {
                            // Primary key press/release
                            if is_key_down {
                                if matches_combo_trigger(
                                    combo_kc,
                                    modifiers,
                                    combo_kc,
                                    &active_mods,
                                ) {
                                    (ctx.key_handler)(true, &mode);
                                }
                            } else if ctx.is_pressed.load(Ordering::SeqCst) {
                                (ctx.key_handler)(false, &mode);
                            }
                        } else if is_key_up {
                            // A modifier key released — only trigger release if combo was active
                            let combo_was_active = ctx.is_pressed.load(Ordering::SeqCst);
                            if combo_was_active {
                                let still_all_held =
                                    modifiers.iter().all(|m| active_mods.contains(m));
                                if !still_all_held {
                                    (ctx.key_handler)(false, &mode);
                                }
                            }
                        }

                        return CallNextHookEx(None, n_code, w_param, l_param);
                    }

                    // Single-key triggers (existing logic)
                    let matches = match trigger {
                        TriggerKey::RightAlt => kbd.vkCode == VK_RMENU,
                        TriggerKey::LeftAlt => kbd.vkCode == VK_LMENU,
                        TriggerKey::Control => kbd.vkCode == VK_LCONTROL,
                        TriggerKey::RightControl => kbd.vkCode == VK_RCONTROL,
                        TriggerKey::Shift => kbd.vkCode == VK_LSHIFT,
                        TriggerKey::Custom { keycode } => kbd.vkCode == keycode as u32,
                        _ => false,
                    };

                    if matches {
                        (ctx.key_handler)(is_key_down, &mode);
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
                shared: Arc::new(Mutex::new(HotkeySharedState {
                    trigger_key: default_key,
                    trigger_mode: TriggerMode::Hold,
                    active_modifiers: HashSet::new(),
                    double_tap: DoubleTapState::new(),
                    recording: RecordingState::new(),
                    toggle_long_press_fired: false,
                })),
                is_pressed: Arc::new(AtomicBool::new(false)),
                is_toggled_on: Arc::new(AtomicBool::new(false)),
                #[cfg(target_os = "macos")]
                run_loop_ref: Arc::new(Mutex::new(None)),
            };

            let hook_state = state.clone();

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
                let _ = hook_state;
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

    fn make_test_state() -> HotkeyListenerState {
        HotkeyListenerState {
            shared: Arc::new(Mutex::new(HotkeySharedState {
                trigger_key: TriggerKey::Fn,
                trigger_mode: TriggerMode::Hold,
                active_modifiers: HashSet::new(),
                double_tap: DoubleTapState::new(),
                recording: RecordingState::new(),
                toggle_long_press_fired: false,
            })),
            is_pressed: Arc::new(AtomicBool::new(false)),
            is_toggled_on: Arc::new(AtomicBool::new(false)),
            #[cfg(target_os = "macos")]
            run_loop_ref: Arc::new(Mutex::new(None)),
        }
    }

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
        let key = TriggerKey::Fn;
        let serialized = serde_json::to_value(&key).unwrap();
        assert_eq!(serialized, json!("fn"));
        let deserialized: TriggerKey = serde_json::from_value(json!("fn")).unwrap();
        assert_eq!(deserialized, TriggerKey::Fn);
    }

    #[test]
    fn test_preset_trigger_key_backward_compat() {
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

    #[test]
    fn test_combo_trigger_key_serde_serialize() {
        let key = TriggerKey::Combo {
            modifiers: vec![ModifierFlag::Command],
            keycode: 38,
        };
        let value = serde_json::to_value(&key).unwrap();
        assert_eq!(
            value,
            json!({"combo": {"modifiers": ["command"], "keycode": 38}})
        );
    }

    #[test]
    fn test_combo_trigger_key_serde_deserialize() {
        let json_val = json!({"combo": {"modifiers": ["command", "shift"], "keycode": 38}});
        let key: TriggerKey = serde_json::from_value(json_val).unwrap();
        assert_eq!(
            key,
            TriggerKey::Combo {
                modifiers: vec![ModifierFlag::Command, ModifierFlag::Shift],
                keycode: 38,
            }
        );
    }

    #[test]
    fn test_combo_trigger_key_serde_roundtrip() {
        let key = TriggerKey::Combo {
            modifiers: vec![ModifierFlag::Control, ModifierFlag::Option],
            keycode: 49,
        };
        let serialized = serde_json::to_string(&key).unwrap();
        let deserialized: TriggerKey = serde_json::from_str(&serialized).unwrap();
        assert_eq!(key, deserialized);
    }

    #[test]
    fn test_modifier_flag_serde() {
        let flag = ModifierFlag::Command;
        let value = serde_json::to_value(&flag).unwrap();
        assert_eq!(value, json!("command"));

        let deserialized: ModifierFlag = serde_json::from_value(json!("shift")).unwrap();
        assert_eq!(deserialized, ModifierFlag::Shift);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_matches_trigger_key_macos_custom() {
        let key = TriggerKey::Custom { keycode: 96 };
        assert!(matches_trigger_key_macos(96, &key));
        assert!(!matches_trigger_key_macos(97, &key));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_escape_keycode_macos() {
        assert_eq!(macos_keycodes::ESCAPE, 53);
    }

    #[test]
    fn test_reset_key_states() {
        let state = make_test_state();
        state.is_pressed.store(true, Ordering::SeqCst);
        state.is_toggled_on.store(true, Ordering::SeqCst);
        state.reset_key_states();
        assert!(!state.is_pressed.load(Ordering::SeqCst));
        assert!(!state.is_toggled_on.load(Ordering::SeqCst));
    }

    // ── Combo matching tests ──

    #[test]
    fn test_matches_combo_trigger_exact_match() {
        let mut active = HashSet::new();
        active.insert(ModifierFlag::Command);

        // Exact match: ⌘+J with only ⌘ held
        assert!(matches_combo_trigger(
            38,
            &[ModifierFlag::Command],
            38,
            &active
        ));
    }

    #[test]
    fn test_matches_combo_trigger_extra_modifier_rejected() {
        let mut active = HashSet::new();
        active.insert(ModifierFlag::Command);
        active.insert(ModifierFlag::Shift);

        // Extra modifier (⇧) held — should NOT match ⌘+J
        assert!(!matches_combo_trigger(
            38,
            &[ModifierFlag::Command],
            38,
            &active
        ));
    }

    #[test]
    fn test_matches_combo_trigger_multi_modifier_match() {
        let mut active = HashSet::new();
        active.insert(ModifierFlag::Command);
        active.insert(ModifierFlag::Shift);

        // Exact match for ⌘+⇧+J
        assert!(matches_combo_trigger(
            38,
            &[ModifierFlag::Command, ModifierFlag::Shift],
            38,
            &active
        ));
    }

    #[test]
    fn test_matches_combo_trigger_missing_modifier() {
        let mut active = HashSet::new();
        active.insert(ModifierFlag::Shift);

        assert!(!matches_combo_trigger(
            38,
            &[ModifierFlag::Command],
            38,
            &active
        ));
    }

    #[test]
    fn test_matches_combo_trigger_wrong_keycode() {
        let mut active = HashSet::new();
        active.insert(ModifierFlag::Command);

        assert!(!matches_combo_trigger(
            39,
            &[ModifierFlag::Command],
            38,
            &active
        ));
    }

    // ── Double-tap tests ──

    #[test]
    fn test_check_double_tap_within_gap() {
        let shared = HotkeySharedState {
            trigger_key: TriggerKey::Fn,
            trigger_mode: TriggerMode::Hold,
            active_modifiers: HashSet::new(),
            double_tap: DoubleTapState {
                last_release_time: Some(Instant::now()),
                last_hold_start: None,
            },
            recording: RecordingState::new(),
            toggle_long_press_fired: false,
        };
        assert!(check_double_tap(&shared));
    }

    #[test]
    fn test_check_double_tap_toggle_mode_skipped() {
        let shared = HotkeySharedState {
            trigger_key: TriggerKey::Fn,
            trigger_mode: TriggerMode::Toggle,
            active_modifiers: HashSet::new(),
            double_tap: DoubleTapState {
                last_release_time: Some(Instant::now()),
                last_hold_start: None,
            },
            recording: RecordingState::new(),
            toggle_long_press_fired: false,
        };
        assert!(!check_double_tap(&shared));
    }

    #[test]
    fn test_check_double_tap_no_previous_release() {
        let shared = HotkeySharedState {
            trigger_key: TriggerKey::Fn,
            trigger_mode: TriggerMode::Hold,
            active_modifiers: HashSet::new(),
            double_tap: DoubleTapState::new(),
            recording: RecordingState::new(),
            toggle_long_press_fired: false,
        };
        assert!(!check_double_tap(&shared));
    }

    #[test]
    fn test_record_release_long_hold_clears() {
        let long_ago = Instant::now() - std::time::Duration::from_millis(500);
        let mut shared = HotkeySharedState {
            trigger_key: TriggerKey::Fn,
            trigger_mode: TriggerMode::Hold,
            active_modifiers: HashSet::new(),
            double_tap: DoubleTapState {
                last_release_time: None,
                last_hold_start: Some(long_ago),
            },
            recording: RecordingState::new(),
            toggle_long_press_fired: false,
        };
        record_release_for_double_tap(&mut shared);
        assert!(shared.double_tap.last_release_time.is_none());
    }

    #[test]
    fn test_record_release_short_hold_records() {
        let recent = Instant::now() - std::time::Duration::from_millis(100);
        let mut shared = HotkeySharedState {
            trigger_key: TriggerKey::Fn,
            trigger_mode: TriggerMode::Hold,
            active_modifiers: HashSet::new(),
            double_tap: DoubleTapState {
                last_release_time: None,
                last_hold_start: Some(recent),
            },
            recording: RecordingState::new(),
            toggle_long_press_fired: false,
        };
        record_release_for_double_tap(&mut shared);
        assert!(shared.double_tap.last_release_time.is_some());
    }
}

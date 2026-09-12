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
    // gh-30：純修飾鍵組合（≥2 顆實體修飾鍵同時按下即觸發）。
    // 鍵碼為平台鍵碼（macOS CGEvent keycode／Windows VK），左右分開；只保證新版讀舊設定，舊版無此 variant。
    Chord {
        keycodes: Vec<u16>,
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

/// gh-30：錄製狀態只消費修飾鍵「轉移」（見 `ModifierTransition`），不讀系統鍵態。
/// `held`：錄製期間按下且尚未放開的實體修飾鍵（按下順序）；
/// `snapshot`：最近一次修飾鍵按下當下同時按著的集合——純修飾鍵全放開時以它決定錄成單鍵還是和弦。
struct RecordingState {
    is_active: bool,
    held: Vec<u16>,
    snapshot: Vec<u16>,
}

impl RecordingState {
    fn new() -> Self {
        Self {
            is_active: false,
            held: Vec::new(),
            snapshot: Vec::new(),
        }
    }

    fn reset(&mut self) {
        self.is_active = false;
        self.held.clear();
        self.snapshot.clear();
    }

    /// 修飾鍵轉移。`removed` 裡不在 `held` 的鍵是 no-op——錄製前就按住的鍵不算。
    /// 回傳 Some 表示純修飾鍵組合已全部放開、錄製完成。
    fn on_modifier_transition(
        &mut self,
        transition: &ModifierTransition,
    ) -> Option<RecordingCapturedPayload> {
        // 上游轉移已保證 added 只含實際新增的鍵（重複 down 在 apply_* 就被忽略）
        self.held.extend(transition.added.iter().copied());
        self.snapshot_if_added(transition);
        let was_nonempty = !self.held.is_empty();
        self.held.retain(|k| !transition.removed.contains(k));
        if !(was_nonempty && self.held.is_empty()) {
            return None;
        }
        let snapshot = std::mem::take(&mut self.snapshot);
        self.reset();
        Some(match snapshot.as_slice() {
            [single] => RecordingCapturedPayload {
                keycode: *single,
                modifiers: vec![],
                chord_keycodes: vec![],
            },
            [.., last] => RecordingCapturedPayload {
                keycode: *last,
                modifiers: vec![],
                chord_keycodes: snapshot.clone(),
            },
            [] => return None,
        })
    }

    fn snapshot_if_added(&mut self, transition: &ModifierTransition) {
        if !transition.added.is_empty() {
            self.snapshot = self.held.clone();
        }
    }

    /// 一般鍵按下：以目前 `held` 映射成修飾旗標（左右去重）擷取。ESC 由呼叫端先擋。
    fn on_primary_key_down(
        &mut self,
        keycode: u16,
        family_of: fn(u16) -> Option<ModifierFlag>,
    ) -> RecordingCapturedPayload {
        let modifiers = flags_from_keys(self.held.iter().copied(), family_of);
        self.reset();
        RecordingCapturedPayload {
            keycode,
            modifiers,
            chord_keycodes: vec![],
        }
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct RecordingCapturedPayload {
    keycode: u16,
    modifiers: Vec<ModifierFlag>,
    /// gh-30：≥2 顆時為純修飾鍵和弦（平台鍵碼）；否則為空
    chord_keycodes: Vec<u16>,
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
    /// gh-30：目前按著的實體修飾鍵（平台鍵碼、左右分開），只由鍵盤事件維護，**永不清空**
    /// （清空後系統合併 flag 分不出「左鍵新按下」與「右鍵仍按住、左鍵剛放開」）；失同步靠家族全放開自癒
    held_modifier_keys: HashSet<u16>,
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

// ========== Physical Modifier Tracking (gh-30) ==========

/// 本事件對 `held_modifier_keys` 造成的轉移，只含實際變動的鍵；同一事件不會同時有非空 added 與 removed。
#[derive(Debug, Default, Clone, PartialEq)]
struct ModifierTransition {
    added: Vec<u16>,
    removed: Vec<u16>,
}

impl ModifierTransition {
    fn is_empty(&self) -> bool {
        self.added.is_empty() && self.removed.is_empty()
    }
}

/// macOS CGEvent keycode → 修飾鍵家族（左右合併）。兩平台的表都無條件編譯，測試在任一 CI 都能跑。
#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
fn modifier_family_macos(keycode: u16) -> Option<ModifierFlag> {
    match keycode {
        macos_keycodes::COMMAND_L | macos_keycodes::COMMAND_R => Some(ModifierFlag::Command),
        macos_keycodes::CONTROL_L | macos_keycodes::CONTROL_R => Some(ModifierFlag::Control),
        macos_keycodes::OPTION_L | macos_keycodes::OPTION_R => Some(ModifierFlag::Option),
        macos_keycodes::SHIFT_L | macos_keycodes::SHIFT_R => Some(ModifierFlag::Shift),
        macos_keycodes::FN => Some(ModifierFlag::Fn),
        _ => None,
    }
}

/// Windows VK → 修飾鍵家族（Win 鍵歸 Command，與既有 Combo 比對一致）。
#[cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]
fn modifier_family_windows(vk: u16) -> Option<ModifierFlag> {
    match vk {
        windows_vk::LSHIFT | windows_vk::RSHIFT => Some(ModifierFlag::Shift),
        windows_vk::LCONTROL | windows_vk::RCONTROL => Some(ModifierFlag::Control),
        windows_vk::LMENU | windows_vk::RMENU => Some(ModifierFlag::Option),
        windows_vk::LWIN | windows_vk::RWIN => Some(ModifierFlag::Command),
        _ => None,
    }
}

#[cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]
mod windows_vk {
    pub const LSHIFT: u16 = 0xA0;
    pub const RSHIFT: u16 = 0xA1;
    pub const LCONTROL: u16 = 0xA2;
    pub const RCONTROL: u16 = 0xA3;
    pub const LMENU: u16 = 0xA4;
    pub const RMENU: u16 = 0xA5;
    pub const LWIN: u16 = 0x5B;
    pub const RWIN: u16 = 0x5C;
}

/// 實體鍵集合 → 修飾旗標集合（左右去重），供 Combo 比對與錄製擷取。
fn flags_from_keys(
    keys: impl IntoIterator<Item = u16>,
    family_of: fn(u16) -> Option<ModifierFlag>,
) -> Vec<ModifierFlag> {
    let set: HashSet<ModifierFlag> = keys.into_iter().filter_map(family_of).collect();
    set.into_iter().collect()
}

/// Windows：明確 down／up。重複 down（自動重複）不產生轉移；up 只在鍵原本在集合時產生。
#[cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]
fn apply_windows_modifier_event(
    held: &mut HashSet<u16>,
    vk: u16,
    is_down: bool,
) -> ModifierTransition {
    if modifier_family_windows(vk).is_none() {
        return ModifierTransition::default();
    }
    let mut t = ModifierTransition::default();
    if is_down {
        if held.insert(vk) {
            t.added.push(vk);
        }
    } else if held.remove(&vk) {
        t.removed.push(vk);
    }
    t
}

/// macOS：FlagsChanged 只給鍵碼與合併後的家族 flag，以 flag 為真相三則：
/// 1. 家族 flag 清 → 該家族全部移出（每次家族全放開都以系統狀態校正，失同步自癒）
/// 2. flag 設且鍵不在集合 → 按下
/// 3. flag 設且鍵已在集合 → 放開（左右同家族兩顆都按著、放其中一顆；下次家族全放開即校正）
#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
fn apply_macos_flags_changed(
    held: &mut HashSet<u16>,
    keycode: u16,
    family_flag_set: bool,
) -> ModifierTransition {
    let Some(family) = modifier_family_macos(keycode) else {
        return ModifierTransition::default();
    };
    let mut t = ModifierTransition::default();
    if !family_flag_set {
        let mut gone: Vec<u16> = held
            .iter()
            .copied()
            .filter(|k| modifier_family_macos(*k) == Some(family.clone()))
            .collect();
        gone.sort_unstable();
        for k in &gone {
            held.remove(k);
        }
        t.removed = gone;
    } else if held.insert(keycode) {
        t.added.push(keycode);
    } else {
        held.remove(&keycode);
        t.removed.push(keycode);
    }
    t
}

/// 和弦觸發判定：某次轉移之後，集合恰等於和弦 → 按下；放開任一和弦鍵且仍按著 → 放開。
/// 多按一顆修飾鍵不觸發（集合不等）；觸發後再多按一顆不重複按下（`handle_key_event` 亦以 swap 去重）。
fn chord_transition(
    chord: &[u16],
    held: &HashSet<u16>,
    transition: &ModifierTransition,
    is_pressed: bool,
) -> Option<bool> {
    if chord.len() < 2 {
        return None;
    }
    if !transition.added.is_empty() {
        let matches = held.len() == chord.len() && chord.iter().all(|k| held.contains(k));
        return if matches { Some(true) } else { None };
    }
    if is_pressed && transition.removed.iter().any(|k| chord.contains(k)) {
        return Some(false);
    }
    None
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
                        log::info!("[hotkey-listener] double-tap detected, emitting mode-toggle");
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
                        log::info!(
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

// gh-30：兩平台都要編（`modifier_family_macos` 與測試無條件引用）；ESCAPE 等只在 macOS 用到
#[allow(dead_code)]
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
    log::info!("[hotkey-listener] AXIsProcessTrusted = {trusted}");
    trusted
}

#[tauri::command]
pub fn check_accessibility_permission_command() -> bool {
    #[cfg(target_os = "macos")]
    {
        check_accessibility_permission()
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

/// gh-30：該鍵碼所屬家族的合併 flag 目前是否為設（左右同家族共用一個 flag）
#[cfg(target_os = "macos")]
fn family_flag_set_macos(keycode: u16, flags: CGEventFlags) -> bool {
    match modifier_family_macos(keycode) {
        Some(ModifierFlag::Command) => flags.contains(CGEventFlags::CGEventFlagCommand),
        Some(ModifierFlag::Control) => flags.contains(CGEventFlags::CGEventFlagControl),
        Some(ModifierFlag::Option) => flags.contains(CGEventFlags::CGEventFlagAlternate),
        Some(ModifierFlag::Shift) => flags.contains(CGEventFlags::CGEventFlagShift),
        Some(ModifierFlag::Fn) => flags.contains(CGEventFlags::CGEventFlagSecondaryFn),
        None => false,
    }
}

/// Handle non-modifier key events during recording mode (macOS).
/// gh-30：修飾鍵轉移已在 event tap 第一把鎖內消費；這裡只處理一般鍵：ESC 拒絕、其他鍵以目前 held 擷取。
#[cfg(target_os = "macos")]
fn handle_recording_event_macos<R: Runtime>(
    app_handle: &AppHandle<R>,
    event_type: CGEventType,
    keycode: u16,
    state: &HotkeyListenerState,
) {
    // Ignore KeyUp / FlagsChanged (already consumed) during recording
    if !matches!(event_type, CGEventType::KeyDown) {
        return;
    }
    {
        {
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

            // Non-modifier key pressed: capture with currently held modifiers
            let payload = shared
                .recording
                .on_primary_key_down(keycode, modifier_family_macos);
            drop(shared);
            log::info!(
                "[hotkey-listener] recording: captured keycode={keycode}, modifiers={:?}",
                payload.modifiers
            );
            let _ = app_handle.emit("hotkey:recording-captured", payload);
        }
    }
}

#[cfg(target_os = "macos")]
fn start_event_tap<R: Runtime>(app_handle: AppHandle<R>, state: HotkeyListenerState) {
    let run_loop_ref = state.run_loop_ref.clone();
    std::thread::spawn(move || {
        log::info!("[hotkey-listener] Creating CGEventTap on thread...");

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

                // gh-30：先把這個事件對實體修飾鍵集合的轉移算出來（一把鎖），錄製與和弦都只看轉移；
                // 同時讀取是否錄製中，避免兩次取鎖之間狀態變化
                // 錄製中的修飾鍵轉移在同一把鎖內消費，實體集合與錄製局部不會失同步
                let (transition, is_recording, recording_captured) = {
                    let mut shared = match state.shared.lock() {
                        Ok(g) => g,
                        Err(_) => return None,
                    };
                    let transition = if matches!(event_type, CGEventType::FlagsChanged) {
                        let flag_set = family_flag_set_macos(keycode, event.get_flags());
                        apply_macos_flags_changed(&mut shared.held_modifier_keys, keycode, flag_set)
                    } else {
                        ModifierTransition::default()
                    };
                    let is_recording = shared.recording.is_active;
                    let captured = if is_recording && !transition.is_empty() {
                        shared.recording.on_modifier_transition(&transition)
                    } else {
                        None
                    };
                    (transition, is_recording, captured)
                };

                // Recording mode: delegate to recording handler, skip all trigger logic
                if is_recording {
                    if let Some(payload) = recording_captured {
                        log::info!(
                            "[hotkey-listener] recording captured keycode={} mods=[] chord={:?}",
                            payload.keycode,
                            payload.chord_keycodes
                        );
                        let _ = app_handle.emit("hotkey:recording-captured", payload);
                    } else if !matches!(event_type, CGEventType::FlagsChanged) {
                        handle_recording_event_macos(&app_handle, event_type, keycode, &state);
                    }
                    return None;
                }

                // Single lock: read trigger config + update active modifiers + snapshot
                let (trigger, mode, active_mods_snapshot, held_snapshot) = {
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
                        shared.held_modifier_keys.clone(),
                    )
                };

                match event_type {
                    CGEventType::FlagsChanged => {
                        let flags = event.get_flags();

                        // gh-30：純修飾鍵和弦——集合恰等於和弦即按下、放開任一顆即結束
                        if let TriggerKey::Chord { ref keycodes } = trigger {
                            let was_pressed = state.is_pressed.load(Ordering::SeqCst);
                            if let Some(pressed) =
                                chord_transition(keycodes, &held_snapshot, &transition, was_pressed)
                            {
                                handle_key_event(&app_handle, pressed, &state, &mode);
                            }
                            return None;
                        }

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
                log::info!("[hotkey-listener] CGEventTap created successfully");
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
                    log::info!("[hotkey-listener] RunLoop started, listening for hotkey events...");
                    CFRunLoop::run_current();
                    if let Ok(mut guard) = run_loop_ref.lock() {
                        *guard = None;
                    }
                    log::info!("[hotkey-listener] RunLoop stopped");
                }
            }
            Err(()) => {
                log::error!("[hotkey-listener] ERROR: Failed to create CGEventTap!");
                log::error!(
                    "[hotkey-listener] Go to System Settings > Privacy & Security > Accessibility"
                );
                log::error!("[hotkey-listener] and add this application.");
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
            log::info!("[hotkey-listener] Stopped existing CFRunLoop");
        }
    }
}

#[tauri::command]
pub fn reset_hotkey_state(state: tauri::State<'_, HotkeyListenerState>) {
    state.reset_key_states();
    log::info!("[hotkey-listener] Key states reset via command");
}

#[tauri::command]
pub fn start_hotkey_recording(state: tauri::State<'_, HotkeyListenerState>) {
    if let Ok(mut shared) = state.shared.lock() {
        shared.recording.reset();
        shared.recording.is_active = true;
    }
    state.is_pressed.store(false, Ordering::SeqCst);
    log::info!("[hotkey-listener] Recording mode started");
}

#[tauri::command]
pub fn cancel_hotkey_recording(state: tauri::State<'_, HotkeyListenerState>) {
    if let Ok(mut shared) = state.shared.lock() {
        shared.recording.reset();
    }
    log::info!("[hotkey-listener] Recording mode cancelled");
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

        log::info!("[hotkey-listener] Reinitialized hotkey listener");
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = &app;
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

    type KeyHandler = Box<dyn Fn(bool, &TriggerMode) + Send + Sync>;

    struct HookContext {
        shared: Arc<Mutex<HotkeySharedState>>,
        is_pressed: Arc<AtomicBool>,
        key_handler: KeyHandler,
        escape_handler: Box<dyn Fn() + Send + Sync>,
        recording_captured_handler: Box<dyn Fn(RecordingCapturedPayload) + Send + Sync>,
        recording_rejected_handler: Box<dyn Fn(RecordingRejectedPayload) + Send + Sync>,
    }

    static CONTEXT: OnceLock<HookContext> = OnceLock::new();

    /// gh-30：錄製中的一般鍵（非修飾鍵）處理：ESC 拒絕、其他鍵以目前 held 擷取。
    /// 修飾鍵轉移已在 `hook_proc` 第一把鎖內消費；不再讀 `GetKeyState`
    /// （hook 執行緒上讀到的是與紀錄相容的「事件前狀態」：按下讀到沒按、放開讀到還按著）。
    fn handle_recording_event_windows(ctx: &HookContext, vk: u16, is_key_down: bool) {
        if !is_key_down {
            return;
        }

        // ESC: reject
        if vk as u32 == VK_ESCAPE {
            if let Ok(mut shared) = ctx.shared.try_lock() {
                shared.recording.reset();
            } else {
                log::warn!("[hotkey-listener] shared lock busy at recording-esc");
            }
            log::info!("[hotkey-listener] recording rejected reason=esc_reserved");
            (ctx.recording_rejected_handler)(RecordingRejectedPayload {
                reason: "esc_reserved".to_string(),
            });
            return;
        }

        // Non-modifier key pressed: capture with currently held modifiers
        let payload = match ctx.shared.try_lock() {
            Ok(mut shared) => shared
                .recording
                .on_primary_key_down(vk, modifier_family_windows),
            Err(_) => {
                log::warn!("[hotkey-listener] shared lock busy at recording-capture");
                RecordingCapturedPayload {
                    keycode: vk,
                    modifiers: vec![],
                    chord_keycodes: vec![],
                }
            }
        };
        log::info!(
            "[hotkey-listener] recording captured keycode=0x{vk:02X} mods={:?}",
            payload.modifiers
        );
        (ctx.recording_captured_handler)(payload);
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
                    if let Err(e) =
                        app_handle_rec_captured.emit("hotkey:recording-captured", payload)
                    {
                        log::error!("[hotkey-listener] emit recording-captured failed: {e}");
                    }
                }),
                recording_rejected_handler: Box::new(move |payload| {
                    if let Err(e) =
                        app_handle_rec_rejected.emit("hotkey:recording-rejected", payload)
                    {
                        log::error!("[hotkey-listener] emit recording-rejected failed: {e}");
                    }
                }),
            })
            .ok();

        std::thread::spawn(move || unsafe {
            use windows::Win32::UI::WindowsAndMessaging::*;

            match SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), None, 0) {
                Ok(hook) => {
                    log::info!("[hotkey-listener] Windows keyboard hook installed");
                    let mut msg = MSG::default();
                    while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                        let _ = TranslateMessage(&msg);
                        DispatchMessageW(&msg);
                    }
                    let _ = UnhookWindowsHookEx(hook);
                }
                Err(e) => {
                    log::error!(
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
                // Ignore Copilot's dedicated VK_F23 signal to avoid interfering with Quick View.
                if kbd.vkCode == VK_F23 {
                    return CallNextHookEx(None, n_code, w_param, l_param);
                }
                // SayIt 自己 SendInput 的 Ctrl+C／Ctrl+V（選取探測、貼上）：
                // 模擬的 Ctrl↓／Ctrl↑ 不是使用者的觸發鍵動作，也不該被自訂鍵擷取收走
                if kbd.dwExtraInfo == crate::plugins::clipboard_paste::SAYIT_INJECTED_EXTRA_INFO {
                    return CallNextHookEx(None, n_code, w_param, l_param);
                }
                let w = w_param.0 as u32;

                let is_key_down = w == WM_KEYDOWN || w == WM_SYSKEYDOWN;
                let is_key_up = w == WM_KEYUP || w == WM_SYSKEYUP;

                if is_key_down || is_key_up {
                    let vk = kbd.vkCode as u16;
                    // gh-30：先把這個事件對實體修飾鍵集合的轉移算出來（一把鎖），錄製、和弦、Combo 都只看它；
                    // 同時讀取是否錄製中
                    // 錄製中的修飾鍵轉移在同一把鎖內消費：實體集合與錄製局部不會因第二次取鎖失敗而失同步
                    let (transition, is_recording, held_snapshot, recording_captured) =
                        match ctx.shared.try_lock() {
                            Ok(mut s) => {
                                let t = apply_windows_modifier_event(
                                    &mut s.held_modifier_keys,
                                    vk,
                                    is_key_down,
                                );
                                let held = s.held_modifier_keys.clone();
                                let is_recording = s.recording.is_active;
                                // 非修飾鍵在 apply_* 就回空轉移，這裡只看「錄製中且有轉移」
                                let captured = if is_recording && !t.is_empty() {
                                    s.recording.on_modifier_transition(&t)
                                } else {
                                    None
                                };
                                (t, is_recording, held, captured)
                            }
                            Err(_) => {
                                // gh-30 診斷：只記階段、不記鍵值（一般模式也會經過這裡）；
                                // 拿不到鎖就當無轉移、非錄製，讓 ESC 與後面的觸發路徑照原本行為走
                                log::warn!("[hotkey-listener] shared lock busy at recording-check");
                                (ModifierTransition::default(), false, HashSet::new(), None)
                            }
                        };
                    if is_recording {
                        // gh-30 診斷：只在錄製中記鍵值，回報者一鍵回報即可看到 hook 有沒有收到
                        log::info!(
                            "[hotkey-listener] recording: vk=0x{:02X} down={}",
                            kbd.vkCode,
                            is_key_down
                        );
                        if let Some(payload) = recording_captured {
                            log::info!(
                                "[hotkey-listener] recording captured keycode=0x{:02X} mods=[] chord={:?}",
                                payload.keycode,
                                payload.chord_keycodes
                            );
                            (ctx.recording_captured_handler)(payload);
                        } else if modifier_family_windows(vk).is_none() {
                            handle_recording_event_windows(ctx, vk, is_key_down);
                        }
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
                            // gh-30：由實體修飾鍵集合映射（左右去重），取代 GetKeyState
                            shared.active_modifiers = flags_from_keys(
                                shared.held_modifier_keys.iter().copied(),
                                modifier_family_windows,
                            )
                            .into_iter()
                            .collect();
                            let mods = shared.active_modifiers.clone();
                            (
                                shared.trigger_key.clone(),
                                shared.trigger_mode.clone(),
                                mods,
                            )
                        }
                        Err(_) => {
                            log::warn!("[hotkey-listener] shared lock busy at trigger");
                            return CallNextHookEx(None, n_code, w_param, l_param);
                        }
                    };

                    // gh-30：純修飾鍵和弦——集合恰等於和弦即按下、放開任一顆即結束
                    if let TriggerKey::Chord { ref keycodes } = trigger {
                        let was_pressed = ctx.is_pressed.load(Ordering::SeqCst);
                        if let Some(pressed) =
                            chord_transition(keycodes, &held_snapshot, &transition, was_pressed)
                        {
                            (ctx.key_handler)(pressed, &mode);
                        }
                        return CallNextHookEx(None, n_code, w_param, l_param);
                    }

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
                    held_modifier_keys: HashSet::new(),
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
                    log::info!("[hotkey-listener] Prompting for Accessibility permission...");
                    prompt_accessibility_permission();
                    std::thread::sleep(std::time::Duration::from_secs(1));
                    let trusted_after = check_accessibility_permission();
                    if !trusted_after {
                        log::info!("[hotkey-listener] WARNING: Still no Accessibility permission.");
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
                log::info!(
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
                held_modifier_keys: HashSet::new(),
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
            assert_eq!(deserialized, expected, "Failed for {json_str}");
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
            held_modifier_keys: HashSet::new(),
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
            held_modifier_keys: HashSet::new(),
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
            held_modifier_keys: HashSet::new(),
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
            held_modifier_keys: HashSet::new(),
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
            held_modifier_keys: HashSet::new(),
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

    // ── gh-30：實體修飾鍵追蹤 / 錄製狀態機 / 和弦 ──

    const VK_LCTRL: u16 = 0xA2;
    const VK_RCTRL: u16 = 0xA3;
    const VK_LALT: u16 = 0xA4;
    const VK_RALT: u16 = 0xA5;
    const VK_C: u16 = 0x43;
    const VK_K: u16 = 0x4B;

    fn t_add(keys: &[u16]) -> ModifierTransition {
        ModifierTransition {
            added: keys.to_vec(),
            removed: vec![],
        }
    }
    fn t_rm(keys: &[u16]) -> ModifierTransition {
        ModifierTransition {
            added: vec![],
            removed: keys.to_vec(),
        }
    }
    fn set(keys: &[u16]) -> HashSet<u16> {
        keys.iter().copied().collect()
    }

    #[test]
    fn windows_transition_down_up_and_autorepeat() {
        let mut held = HashSet::new();
        assert_eq!(
            apply_windows_modifier_event(&mut held, VK_LCTRL, true),
            t_add(&[VK_LCTRL])
        );
        // 自動重複的 down：不產生轉移
        assert!(apply_windows_modifier_event(&mut held, VK_LCTRL, true).is_empty());
        // 非修飾鍵：不碰集合
        assert!(apply_windows_modifier_event(&mut held, VK_K, true).is_empty());
        assert_eq!(
            apply_windows_modifier_event(&mut held, VK_LCTRL, false),
            t_rm(&[VK_LCTRL])
        );
        // 未按過的 up（例如 reset 之前就按住）：no-op
        assert!(apply_windows_modifier_event(&mut held, VK_RALT, false).is_empty());
        assert!(held.is_empty());
    }

    #[test]
    fn macos_transition_same_family_release_one_then_all() {
        use macos_keycodes::{OPTION_L, OPTION_R};
        let mut held = HashSet::new();
        assert_eq!(
            apply_macos_flags_changed(&mut held, OPTION_L, true),
            t_add(&[OPTION_L])
        );
        assert_eq!(
            apply_macos_flags_changed(&mut held, OPTION_R, true),
            t_add(&[OPTION_R])
        );
        // 兩顆都按著、放左：flag 仍設、左已在集合 → 第 3 則移除左
        assert_eq!(
            apply_macos_flags_changed(&mut held, OPTION_L, true),
            t_rm(&[OPTION_L])
        );
        assert_eq!(held, set(&[OPTION_R]));
        // 放右：flag 清 → 第 1 則家族全移除
        assert_eq!(
            apply_macos_flags_changed(&mut held, OPTION_R, false),
            t_rm(&[OPTION_R])
        );
        assert!(held.is_empty());
    }

    #[test]
    fn macos_transition_missed_up_heals_on_family_clear() {
        use macos_keycodes::{CONTROL_L, CONTROL_R};
        let mut held = HashSet::new();
        apply_macos_flags_changed(&mut held, CONTROL_L, true);
        // 漏掉 CONTROL_L 的放開；下一輪按右 Control
        apply_macos_flags_changed(&mut held, CONTROL_R, true);
        assert_eq!(held, set(&[CONTROL_L, CONTROL_R]));
        // 右放開、flag 清 → 整個家族移除（含幽靈左），removed 只含實際移除的鍵
        let t = apply_macos_flags_changed(&mut held, CONTROL_R, false);
        assert_eq!(t.removed, vec![CONTROL_L, CONTROL_R]);
        assert!(held.is_empty());
    }

    #[test]
    fn macos_transition_ignores_non_modifier_and_unknown_family_clear() {
        let mut held = HashSet::new();
        assert!(apply_macos_flags_changed(&mut held, 38, true).is_empty());
        // 家族 flag 清但集合本來就空：removed 為空
        assert!(apply_macos_flags_changed(&mut held, macos_keycodes::SHIFT_L, false).is_empty());
    }

    #[test]
    fn recording_ctrl_c_captures_combo_with_control() {
        // 紀錄鍵序：左 Ctrl↓ C↓
        let mut rec = RecordingState::new();
        rec.is_active = true;
        assert!(rec.on_modifier_transition(&t_add(&[VK_LCTRL])).is_none());
        let p = rec.on_primary_key_down(VK_C, modifier_family_windows);
        assert_eq!(p.keycode, VK_C);
        assert_eq!(p.modifiers, vec![ModifierFlag::Control]);
        assert!(p.chord_keycodes.is_empty());
        assert!(!rec.is_active);
    }

    #[test]
    fn recording_single_modifier_press_release() {
        // 紀錄鍵序：右 Ctrl↓ 右 Ctrl↑
        let mut rec = RecordingState::new();
        rec.is_active = true;
        assert!(rec.on_modifier_transition(&t_add(&[VK_RCTRL])).is_none());
        let p = rec
            .on_modifier_transition(&t_rm(&[VK_RCTRL]))
            .expect("captured");
        assert_eq!(
            p,
            RecordingCapturedPayload {
                keycode: VK_RCTRL,
                modifiers: vec![],
                chord_keycodes: vec![]
            }
        );
    }

    #[test]
    fn recording_two_modifiers_capture_chord_any_release_order() {
        // 紀錄鍵序：右 Alt↓ 右 Ctrl↓ 右 Alt↑ 右 Ctrl↑
        let mut rec = RecordingState::new();
        rec.is_active = true;
        rec.on_modifier_transition(&t_add(&[VK_RALT]));
        rec.on_modifier_transition(&t_add(&[VK_RCTRL]));
        assert!(rec.on_modifier_transition(&t_rm(&[VK_RALT])).is_none());
        let p = rec
            .on_modifier_transition(&t_rm(&[VK_RCTRL]))
            .expect("captured");
        assert_eq!(p.chord_keycodes, vec![VK_RALT, VK_RCTRL]);
        assert_eq!(p.keycode, VK_RCTRL);
        assert!(p.modifiers.is_empty());
    }

    #[test]
    fn recording_snapshot_is_simultaneous_set_not_history() {
        // Ctrl↓ Alt↓ Ctrl↑ Shift↓ 全↑ → 只錄 Alt＋Shift，不錄三鍵
        let mut rec = RecordingState::new();
        rec.is_active = true;
        rec.on_modifier_transition(&t_add(&[VK_LCTRL]));
        rec.on_modifier_transition(&t_add(&[VK_LALT]));
        rec.on_modifier_transition(&t_rm(&[VK_LCTRL]));
        rec.on_modifier_transition(&t_add(&[windows_vk::LSHIFT]));
        rec.on_modifier_transition(&t_rm(&[VK_LALT]));
        let p = rec
            .on_modifier_transition(&t_rm(&[windows_vk::LSHIFT]))
            .expect("captured");
        assert_eq!(p.chord_keycodes, vec![VK_LALT, windows_vk::LSHIFT]);
    }

    #[test]
    fn recording_released_modifier_not_in_primary_capture() {
        // Ctrl↓ Alt↓ Ctrl↑ K↓ → Alt＋K
        let mut rec = RecordingState::new();
        rec.is_active = true;
        rec.on_modifier_transition(&t_add(&[VK_LCTRL]));
        rec.on_modifier_transition(&t_add(&[VK_LALT]));
        rec.on_modifier_transition(&t_rm(&[VK_LCTRL]));
        let p = rec.on_primary_key_down(VK_K, modifier_family_windows);
        assert_eq!(p.modifiers, vec![ModifierFlag::Option]);
    }

    #[test]
    fn recording_pre_held_key_release_is_noop() {
        // 錄製前按住左 Ctrl → 開始錄製 → 左 Ctrl↑（removed 裡的鍵不在局部 held）→ K↓ → Custom(K)
        let mut rec = RecordingState::new();
        rec.is_active = true;
        assert!(rec.on_modifier_transition(&t_rm(&[VK_LCTRL])).is_none());
        assert!(
            rec.is_active,
            "pre-held release must not complete the recording"
        );
        let p = rec.on_primary_key_down(VK_K, modifier_family_windows);
        assert!(p.modifiers.is_empty());
    }

    #[test]
    fn recording_pre_held_same_family_macos_yields_single_right() {
        // 左 Option↓（錄製前）→ 開始錄製 → 右 Option↓ → 左 Option↑ → 右 Option↑ → 單右 Option
        use macos_keycodes::{OPTION_L, OPTION_R};
        let mut held = set(&[OPTION_L]);
        let mut rec = RecordingState::new();
        rec.is_active = true;
        let t1 = apply_macos_flags_changed(&mut held, OPTION_R, true);
        assert!(rec.on_modifier_transition(&t1).is_none());
        let t2 = apply_macos_flags_changed(&mut held, OPTION_L, true); // 第 3 則：移除左
        assert!(rec.on_modifier_transition(&t2).is_none());
        let t3 = apply_macos_flags_changed(&mut held, OPTION_R, false);
        let p = rec.on_modifier_transition(&t3).expect("captured");
        assert_eq!(p.keycode, OPTION_R);
        assert!(p.chord_keycodes.is_empty());
    }

    #[test]
    fn recording_left_and_right_same_family_dedup_to_one_flag() {
        let mut rec = RecordingState::new();
        rec.is_active = true;
        rec.on_modifier_transition(&t_add(&[VK_LCTRL]));
        rec.on_modifier_transition(&t_add(&[VK_RCTRL]));
        let p = rec.on_primary_key_down(VK_K, modifier_family_windows);
        assert_eq!(p.modifiers, vec![ModifierFlag::Control]);
    }

    #[test]
    fn chord_press_release_and_extra_key_rules() {
        let chord = [VK_RALT, VK_RCTRL];
        // 反向順序：先 Ctrl 後 Alt，齊按時按下
        assert_eq!(
            chord_transition(&chord, &set(&[VK_RCTRL]), &t_add(&[VK_RCTRL]), false),
            None
        );
        assert_eq!(
            chord_transition(
                &chord,
                &set(&[VK_RCTRL, VK_RALT]),
                &t_add(&[VK_RALT]),
                false
            ),
            Some(true)
        );
        // 觸發後再多按一顆：不重複按下；那顆放開也不結束
        assert_eq!(
            chord_transition(
                &chord,
                &set(&[VK_RCTRL, VK_RALT, VK_LCTRL]),
                &t_add(&[VK_LCTRL]),
                true
            ),
            None
        );
        assert_eq!(
            chord_transition(&chord, &set(&[VK_RCTRL, VK_RALT]), &t_rm(&[VK_LCTRL]), true),
            None
        );
        // 首鍵放開：結束一次；第二顆放開時 is_pressed 已 false → 不再結束
        assert_eq!(
            chord_transition(&chord, &set(&[VK_RCTRL]), &t_rm(&[VK_RALT]), true),
            Some(false)
        );
        assert_eq!(
            chord_transition(&chord, &set(&[]), &t_rm(&[VK_RCTRL]), false),
            None
        );
        // 多按一顆再湊齊和弦：集合不等，不觸發
        assert_eq!(
            chord_transition(
                &chord,
                &set(&[VK_LCTRL, VK_RCTRL, VK_RALT]),
                &t_add(&[VK_RALT]),
                false
            ),
            None
        );
        // 家族整批移除（macOS 第 1 則）含和弦鍵：結束
        assert_eq!(
            chord_transition(&chord, &set(&[]), &t_rm(&[VK_LCTRL, VK_RCTRL]), true),
            Some(false)
        );
        // 少於兩顆的和弦設定：永不觸發
        assert_eq!(
            chord_transition(&[VK_RALT], &set(&[VK_RALT]), &t_add(&[VK_RALT]), false),
            None
        );
    }

    #[test]
    fn windows_combo_flags_from_tracked_keys_dedup_left_right() {
        let mods: HashSet<ModifierFlag> =
            flags_from_keys([VK_LCTRL, VK_RCTRL, VK_K], modifier_family_windows)
                .into_iter()
                .collect();
        assert_eq!(mods, [ModifierFlag::Control].into_iter().collect());
        // Ctrl↓ K↓：集合映射後與 Combo(Control+K) 精確相符
        assert!(matches_combo_trigger(
            VK_K,
            &[ModifierFlag::Control],
            VK_K,
            &mods
        ));
    }

    #[test]
    fn chord_trigger_key_serde_roundtrip_and_shape() {
        let key = TriggerKey::Chord {
            keycodes: vec![VK_RALT, VK_RCTRL],
        };
        let json = serde_json::to_string(&key).unwrap();
        assert_eq!(json, r#"{"chord":{"keycodes":[165,163]}}"#);
        let back: TriggerKey = serde_json::from_str(&json).unwrap();
        assert_eq!(back, key);
        // 舊形狀仍可解
        let combo: TriggerKey =
            serde_json::from_str(r#"{"combo":{"modifiers":["control"],"keycode":75}}"#).unwrap();
        assert!(matches!(combo, TriggerKey::Combo { .. }));
    }

    #[test]
    fn reset_key_states_keeps_held_modifier_keys() {
        let state = HotkeyListenerState {
            shared: Arc::new(Mutex::new(HotkeySharedState {
                trigger_key: TriggerKey::Fn,
                trigger_mode: TriggerMode::Hold,
                active_modifiers: HashSet::new(),
                held_modifier_keys: set(&[VK_LCTRL, VK_LALT]),
                double_tap: DoubleTapState::new(),
                recording: RecordingState::new(),
                toggle_long_press_fired: false,
            })),
            is_pressed: Arc::new(AtomicBool::new(true)),
            is_toggled_on: Arc::new(AtomicBool::new(false)),
            #[cfg(target_os = "macos")]
            run_loop_ref: Arc::new(Mutex::new(None)),
        };
        state.reset_key_states();
        let shared = state.shared.lock().unwrap();
        assert_eq!(shared.held_modifier_keys, set(&[VK_LCTRL, VK_LALT]));
        assert!(!state.is_pressed.load(Ordering::SeqCst));
    }

    // ── 實作閘補測：事件層序列 ──

    /// 以轉移餵 `chord_transition`、自己維護 is_pressed（`handle_key_event` 以 swap 去重，這裡等價模擬），數開始／停止次數
    fn drive_chord(chord: &[u16], events: &[(u16, bool)]) -> (usize, usize) {
        let mut held = HashSet::new();
        let mut pressed = false;
        let (mut starts, mut stops) = (0, 0);
        for &(vk, down) in events {
            let t = apply_windows_modifier_event(&mut held, vk, down);
            match chord_transition(chord, &held, &t, pressed) {
                Some(true) if !pressed => {
                    pressed = true;
                    starts += 1;
                }
                Some(false) if pressed => {
                    pressed = false;
                    stops += 1;
                }
                _ => {}
            }
        }
        (starts, stops)
    }

    #[test]
    fn chord_hold_sequence_starts_once_stops_once() {
        // A↓ B↓ A↑ B↑ → 開始 1、停止 1（B↑ 不再停止）
        let chord = [VK_RALT, VK_RCTRL];
        assert_eq!(
            drive_chord(
                &chord,
                &[
                    (VK_RALT, true),
                    (VK_RCTRL, true),
                    (VK_RALT, false),
                    (VK_RCTRL, false)
                ]
            ),
            (1, 1)
        );
    }

    #[test]
    fn chord_hold_a_and_repress_b_twice() {
        // 按住 A 重按 B（間隔 > 350ms 的雙擊條件在 handle_key_event，這裡只驗轉移層）：A↓ B↓ B↑ B↓ B↑ → 開始 2、停止 2
        let chord = [VK_RALT, VK_RCTRL];
        assert_eq!(
            drive_chord(
                &chord,
                &[
                    (VK_RALT, true),
                    (VK_RCTRL, true),
                    (VK_RCTRL, false),
                    (VK_RCTRL, true),
                    (VK_RCTRL, false)
                ]
            ),
            (2, 2)
        );
    }

    #[test]
    fn chord_extra_key_after_start_neither_restarts_nor_stops() {
        // A↓ B↓ C↓ C↑ B↑ → 開始 1、停止 1
        let chord = [VK_RALT, VK_RCTRL];
        assert_eq!(
            drive_chord(
                &chord,
                &[
                    (VK_RALT, true),
                    (VK_RCTRL, true),
                    (VK_LCTRL, true),
                    (VK_LCTRL, false),
                    (VK_RCTRL, false)
                ]
            ),
            (1, 1)
        );
    }

    #[test]
    fn recording_repeat_down_from_raw_events_keeps_snapshot() {
        // 自動重複的 Ctrl↓ 由上游忽略；snapshot 不變、放開後仍錄成單 Ctrl
        let mut held = HashSet::new();
        let mut rec = RecordingState::new();
        rec.is_active = true;
        for _ in 0..3 {
            let t = apply_windows_modifier_event(&mut held, VK_LCTRL, true);
            assert!(rec.on_modifier_transition(&t).is_none());
        }
        assert_eq!(rec.held, vec![VK_LCTRL]);
        assert_eq!(rec.snapshot, vec![VK_LCTRL]);
        let t = apply_windows_modifier_event(&mut held, VK_LCTRL, false);
        let p = rec.on_modifier_transition(&t).expect("captured");
        assert_eq!(p.keycode, VK_LCTRL);
        assert!(p.chord_keycodes.is_empty());
    }

    #[test]
    fn recording_fn_plus_control_chord_macos() {
        use macos_keycodes::{CONTROL_L, FN};
        let mut held = HashSet::new();
        let mut rec = RecordingState::new();
        rec.is_active = true;
        rec.on_modifier_transition(&apply_macos_flags_changed(&mut held, FN, true));
        rec.on_modifier_transition(&apply_macos_flags_changed(&mut held, CONTROL_L, true));
        assert!(rec
            .on_modifier_transition(&apply_macos_flags_changed(&mut held, FN, false))
            .is_none());
        let p = rec
            .on_modifier_transition(&apply_macos_flags_changed(&mut held, CONTROL_L, false))
            .expect("captured");
        assert_eq!(p.chord_keycodes, vec![FN, CONTROL_L]);
        // 同一組當觸發鍵：齊按開始、首鍵放開停止
        let chord = [FN, CONTROL_L];
        let mut held = HashSet::new();
        let t1 = apply_macos_flags_changed(&mut held, FN, true);
        assert_eq!(chord_transition(&chord, &held, &t1, false), None);
        let t2 = apply_macos_flags_changed(&mut held, CONTROL_L, true);
        assert_eq!(chord_transition(&chord, &held, &t2, false), Some(true));
        let t3 = apply_macos_flags_changed(&mut held, FN, false);
        assert_eq!(chord_transition(&chord, &held, &t3, true), Some(false));
    }

    #[test]
    fn macos_missed_up_same_key_next_round_documented_behavior() {
        // A↓ (漏 A↑) A↓ A↑：第二個 A↓ 被第 3 則當放開（記錄此取捨），A↑ 家族清 → 集合空、校正完成
        use macos_keycodes::OPTION_L;
        let mut held = HashSet::new();
        apply_macos_flags_changed(&mut held, OPTION_L, true);
        let t = apply_macos_flags_changed(&mut held, OPTION_L, true);
        assert_eq!(t, t_rm(&[OPTION_L]));
        assert!(held.is_empty());
        let t = apply_macos_flags_changed(&mut held, OPTION_L, false);
        assert!(t.is_empty());
        assert!(held.is_empty());
    }

    #[test]
    fn macos_reset_then_release_same_family_no_ghost_press() {
        // 左 Option↓ 右 Option↓ → reset（不清實體集合）→ 左↑（第 3 則）→ 右↑（第 1 則）：無假 down、集合回到空
        use macos_keycodes::{OPTION_L, OPTION_R};
        let state = HotkeyListenerState {
            shared: Arc::new(Mutex::new(HotkeySharedState {
                trigger_key: TriggerKey::Chord {
                    keycodes: vec![OPTION_L, OPTION_R],
                },
                trigger_mode: TriggerMode::Hold,
                active_modifiers: HashSet::new(),
                held_modifier_keys: set(&[OPTION_L, OPTION_R]),
                double_tap: DoubleTapState::new(),
                recording: RecordingState::new(),
                toggle_long_press_fired: false,
            })),
            is_pressed: Arc::new(AtomicBool::new(true)),
            is_toggled_on: Arc::new(AtomicBool::new(false)),
            #[cfg(target_os = "macos")]
            run_loop_ref: Arc::new(Mutex::new(None)),
        };
        state.reset_key_states();
        let mut shared = state.shared.lock().unwrap();
        let chord = [OPTION_L, OPTION_R];
        let t = apply_macos_flags_changed(&mut shared.held_modifier_keys, OPTION_L, true);
        assert_eq!(t, t_rm(&[OPTION_L]));
        assert_eq!(
            chord_transition(&chord, &shared.held_modifier_keys, &t, false),
            None
        );
        let t = apply_macos_flags_changed(&mut shared.held_modifier_keys, OPTION_R, false);
        assert_eq!(t, t_rm(&[OPTION_R]));
        assert_eq!(
            chord_transition(&chord, &shared.held_modifier_keys, &t, false),
            None
        );
        assert!(shared.held_modifier_keys.is_empty());
    }

    #[test]
    fn windows_combo_releasing_ctrl_first_drops_required_modifier() {
        // Ctrl↓ K↓（觸發）→ Ctrl↑：映射後集合缺 Control → hook 的「required modifiers still held」判定為 false → 結束
        let mut held = HashSet::new();
        apply_windows_modifier_event(&mut held, VK_LCTRL, true);
        let mods: HashSet<ModifierFlag> =
            flags_from_keys(held.iter().copied(), modifier_family_windows)
                .into_iter()
                .collect();
        assert!(matches_combo_trigger(
            VK_K,
            &[ModifierFlag::Control],
            VK_K,
            &mods
        ));
        apply_windows_modifier_event(&mut held, VK_LCTRL, false);
        let mods: HashSet<ModifierFlag> =
            flags_from_keys(held.iter().copied(), modifier_family_windows)
                .into_iter()
                .collect();
        let still_all_held = [ModifierFlag::Control].iter().all(|m| mods.contains(m));
        assert!(!still_all_held);
    }
}

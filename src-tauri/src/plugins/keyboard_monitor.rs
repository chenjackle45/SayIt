use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

const MONITOR_DURATION_MS: u64 = 5000;
const CANCEL_CHECK_INTERVAL_MS: u64 = 100;

// Correction monitor constants
const CORRECTION_PHASE1_TIMEOUT_MS: u64 = 5000;
const CORRECTION_IDLE_TIMEOUT_MS: u64 = 3000;
const CORRECTION_HARD_LIMIT_MS: u64 = 15000;
const CORRECTION_ENTER_DEBOUNCE_MS: u64 = 500;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct QualityMonitorResultPayload {
    was_modified: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CorrectionMonitorResultPayload {
    any_key_pressed: bool,
    enter_pressed: bool,
    idle_timeout: bool,
}

pub struct KeyboardMonitorState {
    // Quality monitor state (existing)
    pub is_monitoring: Arc<AtomicBool>,
    pub was_modified: Arc<AtomicBool>,
    pub cancel_token: Arc<AtomicBool>,

    // Correction monitor state (new, fully independent)
    pub correction_monitoring: Arc<AtomicBool>,
    pub correction_any_key_pressed: Arc<AtomicBool>,
    pub correction_enter_pressed: Arc<AtomicBool>,
    pub correction_last_key_time: Arc<Mutex<Instant>>,
    pub correction_cancel_token: Arc<AtomicBool>,
}

impl KeyboardMonitorState {
    pub fn new() -> Self {
        let is_monitoring = Arc::new(AtomicBool::new(false));
        let was_modified = Arc::new(AtomicBool::new(false));
        let correction_monitoring = Arc::new(AtomicBool::new(false));
        let correction_any_key_pressed = Arc::new(AtomicBool::new(false));
        let correction_enter_pressed = Arc::new(AtomicBool::new(false));
        let correction_last_key_time = Arc::new(Mutex::new(Instant::now()));

        // 啟動持久的平台鍵盤監聽器（建立一次，永不銷毀）
        // 靠 is_monitoring / correction_monitoring flag 控制是否處理事件
        // 避免每次轉錄重新建立/銷毀 CGEventTap — 這是幽靈 Enter 的根因
        #[cfg(target_os = "macos")]
        {
            let m = is_monitoring.clone();
            let w = was_modified.clone();
            let cm = correction_monitoring.clone();
            let cak = correction_any_key_pressed.clone();
            let cep = correction_enter_pressed.clone();
            let clkt = correction_last_key_time.clone();
            std::thread::Builder::new()
                .name("keyboard-monitor".to_string())
                .spawn(move || run_persistent_event_tap(m, w, cm, cak, cep, clkt))
                .ok();
        }

        #[cfg(target_os = "windows")]
        {
            let m = is_monitoring.clone();
            let w = was_modified.clone();
            let cm = correction_monitoring.clone();
            let cak = correction_any_key_pressed.clone();
            let cep = correction_enter_pressed.clone();
            let clkt = correction_last_key_time.clone();
            std::thread::Builder::new()
                .name("keyboard-monitor".to_string())
                .spawn(move || run_persistent_hook(m, w, cm, cak, cep, clkt))
                .ok();
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        println!("[keyboard-monitor] Platform not supported, keyboard monitoring disabled");

        Self {
            is_monitoring,
            was_modified,
            cancel_token: Arc::new(AtomicBool::new(false)),
            correction_monitoring,
            correction_any_key_pressed,
            correction_enter_pressed,
            correction_last_key_time,
            correction_cancel_token: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn shutdown(&self) {
        if self.is_monitoring.load(Ordering::SeqCst) {
            self.cancel_token.store(true, Ordering::SeqCst);
        }
        if self.correction_monitoring.load(Ordering::SeqCst) {
            self.correction_cancel_token.store(true, Ordering::SeqCst);
        }
    }
}

/// 分段等待，定期檢查 cancel_token。回傳 true 表示被取消。
fn wait_with_cancellation(
    cancel_token: &Arc<AtomicBool>,
    duration_ms: u64,
    check_interval_ms: u64,
) -> bool {
    let iterations = duration_ms / check_interval_ms;
    for _ in 0..iterations {
        if cancel_token.load(Ordering::SeqCst) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(check_interval_ms));
    }
    false
}

fn emit_quality_result<R: Runtime>(app_handle: &AppHandle<R>, was_modified: bool) {
    let payload = QualityMonitorResultPayload { was_modified };
    let _ = app_handle.emit("quality-monitor:result", payload);
    #[cfg(debug_assertions)]
    println!(
        "[keyboard-monitor] Emitted quality result: wasModified={was_modified}"
    );
}

fn emit_correction_result<R: Runtime>(
    app_handle: &AppHandle<R>,
    any_key_pressed: bool,
    enter_pressed: bool,
    idle_timeout: bool,
) {
    let payload = CorrectionMonitorResultPayload {
        any_key_pressed,
        enter_pressed,
        idle_timeout,
    };
    let _ = app_handle.emit("correction-monitor:result", payload);
    #[cfg(debug_assertions)]
    println!(
        "[keyboard-monitor] Emitted correction result: anyKeyPressed={any_key_pressed}, enterPressed={enter_pressed}, idleTimeout={idle_timeout}"
    );
}

// ========== macOS: Persistent CGEventTap ==========

#[cfg(target_os = "macos")]
mod macos_keycodes {
    pub const BACKSPACE: u16 = 51;
    pub const DELETE: u16 = 117;
    pub const ENTER: u16 = 36;
    pub const KEYPAD_ENTER: u16 = 76;
}

#[cfg(target_os = "macos")]
fn run_persistent_event_tap(
    is_monitoring: Arc<AtomicBool>,
    was_modified: Arc<AtomicBool>,
    correction_monitoring: Arc<AtomicBool>,
    correction_any_key_pressed: Arc<AtomicBool>,
    correction_enter_pressed: Arc<AtomicBool>,
    correction_last_key_time: Arc<Mutex<Instant>>,
) {
    use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
    use core_graphics::event::{
        CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType,
    };

    let tap_result = CGEventTap::new(
        CGEventTapLocation::Session,
        CGEventTapPlacement::HeadInsertEventTap,
        CGEventTapOptions::ListenOnly,
        vec![CGEventType::KeyDown],
        move |_proxy, _event_type, event| {
            let keycode = event.get_integer_value_field(
                core_graphics::event::EventField::KEYBOARD_EVENT_KEYCODE,
            ) as u16;

            // Quality monitor logic (unchanged)
            if is_monitoring.load(Ordering::SeqCst)
                && (keycode == macos_keycodes::BACKSPACE || keycode == macos_keycodes::DELETE) {
                    was_modified.store(true, Ordering::SeqCst);
                    #[cfg(debug_assertions)]
                    println!(
                        "[keyboard-monitor] Quality: detected modify key: keycode={keycode}"
                    );
                }

            // Correction monitor logic (independent)
            if correction_monitoring.load(Ordering::SeqCst) {
                correction_any_key_pressed.store(true, Ordering::SeqCst);
                if let Ok(mut t) = correction_last_key_time.lock() {
                    *t = Instant::now();
                }
                if keycode == macos_keycodes::ENTER || keycode == macos_keycodes::KEYPAD_ENTER {
                    correction_enter_pressed.store(true, Ordering::SeqCst);
                    #[cfg(debug_assertions)]
                    println!("[keyboard-monitor] Correction: detected Enter key");
                }
            }

            None
        },
    );

    match tap_result {
        Ok(tap) => {
            println!("[keyboard-monitor] Persistent CGEventTap created");
            unsafe {
                let loop_source = tap
                    .mach_port
                    .create_runloop_source(0)
                    .expect("Failed to create runloop source");
                let run_loop = CFRunLoop::get_current();
                run_loop.add_source(&loop_source, kCFRunLoopCommonModes);
                tap.enable();
                CFRunLoop::run_current();
                println!("[keyboard-monitor] Persistent CGEventTap stopped");
            }
        }
        Err(()) => {
            eprintln!(
                "[keyboard-monitor] Failed to create CGEventTap (no Accessibility permission?)"
            );
        }
    }
}

// ========== Windows: Persistent Keyboard Hook ==========

#[cfg(target_os = "windows")]
fn run_persistent_hook(
    is_monitoring: Arc<AtomicBool>,
    was_modified: Arc<AtomicBool>,
    correction_monitoring: Arc<AtomicBool>,
    correction_any_key_pressed: Arc<AtomicBool>,
    correction_enter_pressed: Arc<AtomicBool>,
    correction_last_key_time: Arc<Mutex<Instant>>,
) {
    use std::sync::OnceLock;

    const VK_BACK: u32 = 0x08;
    const VK_DELETE: u32 = 0x2E;
    const VK_RETURN: u32 = 0x0D;
    const WM_KEYDOWN: u32 = 0x0100;
    const WM_SYSKEYDOWN: u32 = 0x0104;

    struct HookState {
        is_monitoring: Arc<AtomicBool>,
        was_modified: Arc<AtomicBool>,
        correction_monitoring: Arc<AtomicBool>,
        correction_any_key_pressed: Arc<AtomicBool>,
        correction_enter_pressed: Arc<AtomicBool>,
        correction_last_key_time: Arc<Mutex<Instant>>,
    }

    static HOOK_STATE: OnceLock<HookState> = OnceLock::new();
    let _ = HOOK_STATE.set(HookState {
        is_monitoring,
        was_modified,
        correction_monitoring,
        correction_any_key_pressed,
        correction_enter_pressed,
        correction_last_key_time,
    });

    unsafe extern "system" fn hook_proc(
        n_code: i32,
        w_param: windows::Win32::Foundation::WPARAM,
        l_param: windows::Win32::Foundation::LPARAM,
    ) -> windows::Win32::Foundation::LRESULT {
        use windows::Win32::UI::WindowsAndMessaging::*;

        if n_code >= 0 {
            if let Some(state) = HOOK_STATE.get() {
                let kbd = *(l_param.0 as *const KBDLLHOOKSTRUCT);
                let w = w_param.0 as u32;

                if w == WM_KEYDOWN || w == WM_SYSKEYDOWN {
                    // Quality monitor logic (unchanged)
                    if state.is_monitoring.load(Ordering::SeqCst) {
                        if kbd.vkCode == VK_BACK || kbd.vkCode == VK_DELETE {
                            state.was_modified.store(true, Ordering::SeqCst);
                            #[cfg(debug_assertions)]
                            println!(
                                "[keyboard-monitor] Quality: detected modify key: vkCode=0x{:02X}",
                                kbd.vkCode
                            );
                        }
                    }

                    // Correction monitor logic (independent)
                    if state.correction_monitoring.load(Ordering::SeqCst) {
                        state.correction_any_key_pressed.store(true, Ordering::SeqCst);
                        if let Ok(mut t) = state.correction_last_key_time.lock() {
                            *t = Instant::now();
                        }
                        if kbd.vkCode == VK_RETURN {
                            state.correction_enter_pressed.store(true, Ordering::SeqCst);
                            #[cfg(debug_assertions)]
                            println!("[keyboard-monitor] Correction: detected Enter key");
                        }
                    }
                }
            }
        }

        CallNextHookEx(None, n_code, w_param, l_param)
    }

    unsafe {
        use windows::Win32::Foundation::*;
        use windows::Win32::UI::WindowsAndMessaging::*;

        match SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), None, 0) {
            Ok(hook) => {
                println!("[keyboard-monitor] Persistent Windows hook installed");
                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
                let _ = UnhookWindowsHookEx(hook);
                println!("[keyboard-monitor] Persistent Windows hook removed");
            }
            Err(e) => {
                eprintln!("[keyboard-monitor] Failed to install persistent hook: {}", e);
            }
        }
    }
}

// ========== Tauri Commands ==========

#[tauri::command]
pub fn start_quality_monitor<R: Runtime>(app: AppHandle<R>) {
    let state = app.state::<KeyboardMonitorState>();

    // 若已有監控進行中，先取消
    if state.is_monitoring.load(Ordering::SeqCst) {
        #[cfg(debug_assertions)]
        println!("[keyboard-monitor] Cancelling previous quality monitor session");
        state.cancel_token.store(true, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(150));
    }

    // 重置狀態
    state.was_modified.store(false, Ordering::SeqCst);
    state.is_monitoring.store(true, Ordering::SeqCst);
    state.cancel_token.store(false, Ordering::SeqCst);

    #[cfg(debug_assertions)]
    println!("[keyboard-monitor] Starting quality monitor");

    // 計時器：5 秒後結束監控並回傳結果
    // 持久 CGEventTap/Hook 已在背景運行，這裡只控制 flag 和計時
    let is_monitoring = state.is_monitoring.clone();
    let was_modified = state.was_modified.clone();
    let cancel_token = state.cancel_token.clone();

    std::thread::spawn(move || {
        let cancelled = wait_with_cancellation(
            &cancel_token,
            MONITOR_DURATION_MS,
            CANCEL_CHECK_INTERVAL_MS,
        );
        if cancelled {
            #[cfg(debug_assertions)]
            println!("[keyboard-monitor] Quality monitoring cancelled");
        }
        is_monitoring.store(false, Ordering::SeqCst);
        emit_quality_result(&app, was_modified.load(Ordering::SeqCst));
    });
}

#[tauri::command]
pub fn start_correction_monitor<R: Runtime>(app: AppHandle<R>) {
    let state = app.state::<KeyboardMonitorState>();

    // 若已有 correction 監控進行中，先取消
    if state.correction_monitoring.load(Ordering::SeqCst) {
        #[cfg(debug_assertions)]
        println!("[keyboard-monitor] Cancelling previous correction monitor session");
        state.correction_cancel_token.store(true, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(150));
    }

    // 重置所有 correction state
    state
        .correction_any_key_pressed
        .store(false, Ordering::SeqCst);
    state
        .correction_enter_pressed
        .store(false, Ordering::SeqCst);
    if let Ok(mut t) = state.correction_last_key_time.lock() {
        *t = Instant::now();
    }
    state.correction_monitoring.store(true, Ordering::SeqCst);
    state
        .correction_cancel_token
        .store(false, Ordering::SeqCst);

    #[cfg(debug_assertions)]
    println!("[keyboard-monitor] Starting correction monitor");

    let correction_monitoring = state.correction_monitoring.clone();
    let any_key_pressed = state.correction_any_key_pressed.clone();
    let enter_pressed = state.correction_enter_pressed.clone();
    let last_key_time = state.correction_last_key_time.clone();
    let cancel_token = state.correction_cancel_token.clone();

    std::thread::spawn(move || {
        let phase1_start = Instant::now();

        // Phase 1: 等待首次按鍵，最長 CORRECTION_PHASE1_TIMEOUT_MS
        loop {
            if cancel_token.load(Ordering::SeqCst) {
                correction_monitoring.store(false, Ordering::SeqCst);
                return;
            }

            if any_key_pressed.load(Ordering::SeqCst) {
                // 偵測到首次按鍵，立即進入 Phase 2
                #[cfg(debug_assertions)]
                println!("[keyboard-monitor] Correction: Phase 1 → Phase 2 (key detected)");
                break;
            }

            if phase1_start.elapsed() >= Duration::from_millis(CORRECTION_PHASE1_TIMEOUT_MS) {
                // Phase 1 timeout：使用者沒按任何鍵
                correction_monitoring.store(false, Ordering::SeqCst);
                emit_correction_result(&app, false, false, false);
                return;
            }

            std::thread::sleep(Duration::from_millis(CANCEL_CHECK_INTERVAL_MS));
        }

        // Phase 2: 追蹤修正，等 Enter 或 idle timeout
        let phase2_start = Instant::now();

        loop {
            if cancel_token.load(Ordering::SeqCst) {
                correction_monitoring.store(false, Ordering::SeqCst);
                return;
            }

            // Enter 偵測（debounce 500ms — IME 選字也按 Enter）
            if enter_pressed.load(Ordering::SeqCst) {
                // 記錄 Enter 時間，等 debounce 期間是否有新按鍵
                let enter_time = Instant::now();
                // 重設 flag + last_key_time snapshot
                enter_pressed.store(false, Ordering::SeqCst);
                let key_time_at_enter = last_key_time.lock().map(|t| *t).unwrap_or(enter_time);

                #[cfg(debug_assertions)]
                println!("[keyboard-monitor] Correction: Enter debounce started ({CORRECTION_ENTER_DEBOUNCE_MS}ms)");

                let mut ime_followup = false;
                while enter_time.elapsed() < Duration::from_millis(CORRECTION_ENTER_DEBOUNCE_MS) {
                    if cancel_token.load(Ordering::SeqCst) {
                        correction_monitoring.store(false, Ordering::SeqCst);
                        return;
                    }
                    // 檢查 debounce 期間是否有新按鍵（last_key_time 比 Enter 時更新）
                    if let Ok(t) = last_key_time.lock() {
                        if *t > key_time_at_enter {
                            ime_followup = true;
                            break;
                        }
                    }
                    std::thread::sleep(Duration::from_millis(CANCEL_CHECK_INTERVAL_MS));
                }

                if ime_followup {
                    // IME 選字後繼續打字，不是真正的 Enter 送出
                    #[cfg(debug_assertions)]
                    println!("[keyboard-monitor] Correction: Enter was IME confirm, continuing");
                    continue;
                }

                // debounce 期間無新按鍵 → 真正的 Enter 送出
                #[cfg(debug_assertions)]
                println!("[keyboard-monitor] Correction: Enter confirmed (real send)");
                correction_monitoring.store(false, Ordering::SeqCst);
                emit_correction_result(&app, true, true, false);
                return;
            }

            // Idle timeout：最後按鍵後 3 秒無新按鍵
            let idle_duration = if let Ok(t) = last_key_time.lock() {
                t.elapsed()
            } else {
                Duration::from_secs(0)
            };
            if idle_duration >= Duration::from_millis(CORRECTION_IDLE_TIMEOUT_MS) {
                correction_monitoring.store(false, Ordering::SeqCst);
                emit_correction_result(&app, true, false, true);
                return;
            }

            // 硬上限 15 秒
            if phase2_start.elapsed() >= Duration::from_millis(CORRECTION_HARD_LIMIT_MS) {
                correction_monitoring.store(false, Ordering::SeqCst);
                emit_correction_result(&app, true, false, false);
                return;
            }

            std::thread::sleep(Duration::from_millis(CANCEL_CHECK_INTERVAL_MS));
        }
    });
}

// ========== Tests ==========

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keyboard_monitor_state_initial_values() {
        let state = KeyboardMonitorState::new();
        assert!(!state.is_monitoring.load(Ordering::SeqCst));
        assert!(!state.was_modified.load(Ordering::SeqCst));
        assert!(!state.cancel_token.load(Ordering::SeqCst));
        assert!(!state.correction_monitoring.load(Ordering::SeqCst));
        assert!(!state.correction_any_key_pressed.load(Ordering::SeqCst));
        assert!(!state.correction_enter_pressed.load(Ordering::SeqCst));
        assert!(!state.correction_cancel_token.load(Ordering::SeqCst));
    }

    #[test]
    fn test_state_reset_logic() {
        let state = KeyboardMonitorState::new();
        state.is_monitoring.store(true, Ordering::SeqCst);
        state.was_modified.store(true, Ordering::SeqCst);
        state.cancel_token.store(true, Ordering::SeqCst);

        // 模擬重置
        state.was_modified.store(false, Ordering::SeqCst);
        state.is_monitoring.store(true, Ordering::SeqCst);
        state.cancel_token.store(false, Ordering::SeqCst);

        assert!(state.is_monitoring.load(Ordering::SeqCst));
        assert!(!state.was_modified.load(Ordering::SeqCst));
        assert!(!state.cancel_token.load(Ordering::SeqCst));
    }

    #[test]
    fn test_cancel_token_stops_monitoring() {
        let state = KeyboardMonitorState::new();
        state.is_monitoring.store(true, Ordering::SeqCst);

        // 設定取消
        state.cancel_token.store(true, Ordering::SeqCst);

        assert!(state.cancel_token.load(Ordering::SeqCst));
    }

    #[test]
    fn test_wait_with_cancellation_normal_expiry() {
        let cancel_token = Arc::new(AtomicBool::new(false));
        let cancelled = wait_with_cancellation(&cancel_token, 200, 100);
        assert!(!cancelled);
    }

    #[test]
    fn test_wait_with_cancellation_cancelled() {
        let cancel_token = Arc::new(AtomicBool::new(false));
        let cancel_clone = cancel_token.clone();

        // 另一個執行緒在 50ms 後取消
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            cancel_clone.store(true, Ordering::SeqCst);
        });

        let cancelled = wait_with_cancellation(&cancel_token, 5000, 100);
        assert!(cancelled);
    }

    #[test]
    fn test_correction_state_independence() {
        let state = KeyboardMonitorState::new();

        // quality monitor active
        state.is_monitoring.store(true, Ordering::SeqCst);
        state.was_modified.store(true, Ordering::SeqCst);

        // correction monitor state should be independent
        assert!(!state.correction_monitoring.load(Ordering::SeqCst));
        assert!(!state.correction_any_key_pressed.load(Ordering::SeqCst));
        assert!(!state.correction_enter_pressed.load(Ordering::SeqCst));

        // Start correction monitor
        state.correction_monitoring.store(true, Ordering::SeqCst);
        state
            .correction_any_key_pressed
            .store(true, Ordering::SeqCst);

        // quality monitor state should remain unchanged
        assert!(state.is_monitoring.load(Ordering::SeqCst));
        assert!(state.was_modified.load(Ordering::SeqCst));
    }

    #[test]
    fn test_correction_shutdown() {
        let state = KeyboardMonitorState::new();
        state.correction_monitoring.store(true, Ordering::SeqCst);
        state.is_monitoring.store(true, Ordering::SeqCst);

        state.shutdown();

        assert!(state.cancel_token.load(Ordering::SeqCst));
        assert!(state.correction_cancel_token.load(Ordering::SeqCst));
    }
}

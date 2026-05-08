use arboard::Clipboard;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Runtime, State};

// ========== Focus State ==========

/// 儲存使用者啟動錄音前的前景視窗，貼上時恢復焦點。
/// Windows 上 SendInput 會送到當前前景視窗，若 HUD 搶了焦點，Ctrl+V 會進 HUD 而非目標 app。
pub struct FocusState {
    #[cfg(target_os = "windows")]
    target_hwnd: std::sync::Mutex<isize>,
}

impl FocusState {
    pub fn new() -> Self {
        Self {
            #[cfg(target_os = "windows")]
            target_hwnd: std::sync::Mutex::new(0),
        }
    }
}

// ========== Errors ==========

#[derive(Debug, thiserror::Error)]
pub enum ClipboardError {
    #[error("Clipboard access failed: {0}")]
    ClipboardAccess(String),
    #[error("Keyboard simulation failed: {0}")]
    KeyboardSimulation(String),
}

impl serde::Serialize for ClipboardError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

/// 透過 CGEvent 模擬 Cmd+V 鍵盤事件來觸發貼上。
///
/// 事件序列：Cmd↓ → V↓ → V↑ → Cmd↑
/// keycodes: Command_L=55, V=9
/// 需要 Accessibility 權限（已有）。
/// 4 事件完整配對，paste 場景下幽靈按鍵風險趨近於零。
#[cfg(target_os = "macos")]
fn simulate_paste_via_cgevent() -> Result<(), String> {
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    const KEYCODE_COMMAND_L: u16 = 55;
    const KEYCODE_V: u16 = 9;

    // Private source：隔離的事件源，不繼承物理鍵盤的 modifier 狀態
    // 解決 Toggle 模式下右 Option 殘留 Alternate flag 導致重複貼上的問題
    let source = CGEventSource::new(CGEventSourceStateID::Private)
        .map_err(|_| "Failed to create CGEventSource".to_string())?;

    // Cmd ↓
    let cmd_down = CGEvent::new_keyboard_event(source.clone(), KEYCODE_COMMAND_L, true)
        .map_err(|_| "Failed to create Cmd down event".to_string())?;
    cmd_down.set_flags(CGEventFlags::CGEventFlagCommand);

    // V ↓ (with Command flag)
    let v_down = CGEvent::new_keyboard_event(source.clone(), KEYCODE_V, true)
        .map_err(|_| "Failed to create V down event".to_string())?;
    v_down.set_flags(CGEventFlags::CGEventFlagCommand);

    // V ↑ (with Command flag)
    let v_up = CGEvent::new_keyboard_event(source.clone(), KEYCODE_V, false)
        .map_err(|_| "Failed to create V up event".to_string())?;
    v_up.set_flags(CGEventFlags::CGEventFlagCommand);

    // Cmd ↑
    let cmd_up = CGEvent::new_keyboard_event(source, KEYCODE_COMMAND_L, false)
        .map_err(|_| "Failed to create Cmd up event".to_string())?;
    cmd_up.set_flags(CGEventFlags::CGEventFlagNull);

    // Post events in sequence (Session 層：避免新版 macOS HID 管線重複投遞)
    cmd_down.post(CGEventTapLocation::Session);
    v_down.post(CGEventTapLocation::Session);
    v_up.post(CGEventTapLocation::Session);
    cmd_up.post(CGEventTapLocation::Session);

    Ok(())
}

/// 透過 CGEvent 模擬 Cmd+C 鍵盤事件來觸發複製。
///
/// 事件序列：Cmd↓ → C↓ → C↑ → Cmd↑
/// keycodes: Command_L=55, C=8
#[cfg(target_os = "macos")]
fn simulate_copy_via_cgevent() -> Result<(), String> {
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    const KEYCODE_COMMAND_L: u16 = 55;
    const KEYCODE_C: u16 = 8;

    let source = CGEventSource::new(CGEventSourceStateID::Private)
        .map_err(|_| "Failed to create CGEventSource".to_string())?;

    let cmd_down = CGEvent::new_keyboard_event(source.clone(), KEYCODE_COMMAND_L, true)
        .map_err(|_| "Failed to create Cmd down event".to_string())?;
    cmd_down.set_flags(CGEventFlags::CGEventFlagCommand);

    let c_down = CGEvent::new_keyboard_event(source.clone(), KEYCODE_C, true)
        .map_err(|_| "Failed to create C down event".to_string())?;
    c_down.set_flags(CGEventFlags::CGEventFlagCommand);

    let c_up = CGEvent::new_keyboard_event(source.clone(), KEYCODE_C, false)
        .map_err(|_| "Failed to create C up event".to_string())?;
    c_up.set_flags(CGEventFlags::CGEventFlagCommand);

    let cmd_up = CGEvent::new_keyboard_event(source, KEYCODE_COMMAND_L, false)
        .map_err(|_| "Failed to create Cmd up event".to_string())?;
    cmd_up.set_flags(CGEventFlags::CGEventFlagNull);

    cmd_down.post(CGEventTapLocation::Session);
    c_down.post(CGEventTapLocation::Session);
    c_up.post(CGEventTapLocation::Session);
    cmd_up.post(CGEventTapLocation::Session);

    Ok(())
}

/// 透過 SendInput 模擬 Ctrl+C 按鍵來觸發複製。
#[cfg(target_os = "windows")]
fn simulate_copy_via_keyboard() -> Result<(), String> {
    use std::mem;
    use windows::Win32::UI::Input::KeyboardAndMouse::*;

    unsafe {
        let mut inputs: [INPUT; 4] = mem::zeroed();

        inputs[0].r#type = INPUT_KEYBOARD;
        inputs[0].Anonymous.ki.wVk = VK_CONTROL;

        inputs[1].r#type = INPUT_KEYBOARD;
        inputs[1].Anonymous.ki.wVk = VK_C;

        inputs[2].r#type = INPUT_KEYBOARD;
        inputs[2].Anonymous.ki.wVk = VK_C;
        inputs[2].Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;

        inputs[3].r#type = INPUT_KEYBOARD;
        inputs[3].Anonymous.ki.wVk = VK_CONTROL;
        inputs[3].Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;

        let sent = SendInput(&inputs, mem::size_of::<INPUT>() as i32);
        if sent != 4 {
            return Err(format!("SendInput returned {}, expected 4", sent));
        }
    }

    Ok(())
}

/// 透過 SendInput 模擬 Ctrl+V 按鍵來觸發貼上。
///
/// Windows 不像 macOS 有 CGEvent 殘留問題，SendInput 是標準做法。
/// SendInput 會送到當前前景視窗，因此呼叫前必須確保目標視窗已是前景。
#[cfg(target_os = "windows")]
fn simulate_paste_via_keyboard() -> Result<(), String> {
    use std::mem;
    use windows::Win32::UI::Input::KeyboardAndMouse::*;

    unsafe {
        let mut inputs: [INPUT; 4] = mem::zeroed();

        // Ctrl ↓
        inputs[0].r#type = INPUT_KEYBOARD;
        inputs[0].Anonymous.ki.wVk = VK_CONTROL;

        // V ↓
        inputs[1].r#type = INPUT_KEYBOARD;
        inputs[1].Anonymous.ki.wVk = VK_V;

        // V ↑
        inputs[2].r#type = INPUT_KEYBOARD;
        inputs[2].Anonymous.ki.wVk = VK_V;
        inputs[2].Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;

        // Ctrl ↑
        inputs[3].r#type = INPUT_KEYBOARD;
        inputs[3].Anonymous.ki.wVk = VK_CONTROL;
        inputs[3].Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;

        let sent = SendInput(&inputs, mem::size_of::<INPUT>() as i32);
        if sent != 4 {
            return Err(format!("SendInput returned {}, expected 4", sent));
        }
    }

    Ok(())
}

/// 恢復先前捕獲的前景視窗焦點。
/// 使用 AttachThreadInput 技巧繞過 Windows 對 SetForegroundWindow 的限制。
#[cfg(target_os = "windows")]
fn restore_target_window(hwnd_value: isize) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Threading::AttachThreadInput;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow,
    };

    unsafe {
        let target = HWND(hwnd_value as *mut _);
        let current_fg = GetForegroundWindow();

        if current_fg == target {
            return; // 已是前景，無需操作
        }

        let current_thread = GetWindowThreadProcessId(current_fg, None);
        let target_thread = GetWindowThreadProcessId(target, None);

        if current_thread != target_thread && current_thread != 0 && target_thread != 0 {
            let _ = AttachThreadInput(current_thread, target_thread, true);
            let _ = SetForegroundWindow(target);
            let _ = AttachThreadInput(current_thread, target_thread, false);
        } else {
            let _ = SetForegroundWindow(target);
        }

        println!("[clipboard-paste] Restored target window: {:?}", target);
    }
}

/// 捕獲當前前景視窗，供後續 paste_text 恢復焦點。
/// 應在 hotkey 觸發時（HUD 顯示前）呼叫。
#[tauri::command]
pub fn capture_target_window(state: State<'_, FocusState>) {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
        unsafe {
            let hwnd = GetForegroundWindow();
            if let Ok(mut guard) = state.target_hwnd.lock() {
                *guard = hwnd.0 as isize;
            }
            println!("[clipboard-paste] Captured target window: {:?}", hwnd);
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = state;
    }
}

/// 透過模擬 Cmd+C（macOS）/ Ctrl+C（Windows）擷取當前選取的文字。
///
/// 流程：儲存剪貼簿 → 清空 → 模擬複製 → 等待 → 讀取 → 還原 → 回傳。
/// 對任何支援 Cmd+C 的 app 都有效，不依賴 Accessibility API。
pub fn capture_selected_text_via_clipboard() -> Result<Option<String>, String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;

    // 1. 儲存當前剪貼簿文字
    let original_text = clipboard.get_text().ok();

    // 2. 清空剪貼簿作為哨兵值
    clipboard.set_text("").map_err(|e| e.to_string())?;

    // 3. 模擬 Cmd+C / Ctrl+C（失敗時先還原剪貼簿再 return）
    let copy_result = {
        #[cfg(target_os = "macos")]
        { simulate_copy_via_cgevent() }
        #[cfg(target_os = "windows")]
        { simulate_copy_via_keyboard() }
    };
    if let Err(e) = copy_result {
        restore_clipboard(&mut clipboard, &original_text);
        return Err(e);
    }

    // 4. 等待剪貼簿更新
    thread::sleep(Duration::from_millis(100));

    // 5. 讀取剪貼簿
    let copied_text = clipboard.get_text().ok().filter(|t| !t.is_empty());

    // 6. 還原剪貼簿
    restore_clipboard(&mut clipboard, &original_text);

    // 7. 回傳
    match copied_text {
        Some(text) => {
            eprintln!(
                "[clipboard-paste] capture_selected_text: got {} chars",
                text.len()
            );
            Ok(Some(text))
        }
        None => {
            eprintln!("[clipboard-paste] capture_selected_text: no selection detected");
            Ok(None)
        }
    }
}

fn restore_clipboard(clipboard: &mut Clipboard, original_text: &Option<String>) {
    if let Some(ref text) = original_text {
        if let Err(e) = clipboard.set_text(text) {
            eprintln!("[clipboard-paste] failed to restore clipboard: {e}");
        }
    }
}

#[tauri::command]
pub fn copy_to_clipboard(text: String) -> Result<(), ClipboardError> {
    let mut clipboard =
        Clipboard::new().map_err(|e| ClipboardError::ClipboardAccess(e.to_string()))?;
    clipboard
        .set_text(&text)
        .map_err(|e| ClipboardError::ClipboardAccess(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub fn paste_text<R: Runtime>(
    _app: AppHandle<R>,
    focus_state: State<'_, FocusState>,
    text: String,
) -> Result<(), ClipboardError> {
    // DEBUG: 追蹤 paste_text 被呼叫次數
    use std::sync::atomic::AtomicU32;
    static PASTE_CALL_COUNT: AtomicU32 = AtomicU32::new(0);
    let call_id = PASTE_CALL_COUNT.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
    println!(
        "🔴🔴🔴 [clipboard-paste] paste_text CALLED (#{}) — {} chars",
        call_id,
        text.len()
    );
    #[cfg(debug_assertions)]
    println!(
        "[clipboard-paste] Pasting {} chars: \"{}\"",
        text.len(),
        text
    );
    #[cfg(not(debug_assertions))]
    println!("[clipboard-paste] Pasting {} chars", text.len());

    // 1) 寫入剪貼簿
    let mut clipboard =
        Clipboard::new().map_err(|e| ClipboardError::ClipboardAccess(e.to_string()))?;
    clipboard
        .set_text(&text)
        .map_err(|e| ClipboardError::ClipboardAccess(e.to_string()))?;
    println!("[clipboard-paste] Text copied to clipboard");

    // 2) 等待剪貼簿同步
    thread::sleep(Duration::from_millis(50));

    // 3) 觸發目標 app 的貼上動作
    #[cfg(target_os = "macos")]
    {
        let _ = &focus_state; // macOS 不需要焦點恢復（CGEvent 是進程級）
        simulate_paste_via_cgevent().map_err(|e| {
            eprintln!("[clipboard-paste] CGEvent paste failed: {e}");
            ClipboardError::KeyboardSimulation(e)
        })?;
        println!("[clipboard-paste] Paste triggered via CGEvent (Cmd+V)");
    }

    #[cfg(target_os = "windows")]
    {
        // 恢復錄音前的前景視窗，確保 SendInput 送到正確目標
        let saved_hwnd = focus_state.target_hwnd.lock().ok().map(|g| *g).unwrap_or(0);
        if saved_hwnd != 0 {
            restore_target_window(saved_hwnd);
            thread::sleep(Duration::from_millis(50));
        }

        simulate_paste_via_keyboard().map_err(|e| {
            eprintln!("[clipboard-paste] SendInput paste failed: {}", e);
            ClipboardError::KeyboardSimulation(e)
        })?;
        println!("[clipboard-paste] Paste triggered via SendInput (Ctrl+V)");
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        compile_error!("paste_text keyboard simulation is not implemented for this platform");
    }

    println!("[clipboard-paste] Done");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ============================================================
    // ClipboardError Display 格式化測試
    // ============================================================

    #[test]
    fn test_clipboard_access_error_display() {
        let error = ClipboardError::ClipboardAccess("permission denied".to_string());
        assert_eq!(
            error.to_string(),
            "Clipboard access failed: permission denied"
        );
    }

    #[test]
    fn test_keyboard_simulation_error_display() {
        let error = ClipboardError::KeyboardSimulation("CGEvent failed".to_string());
        assert_eq!(
            error.to_string(),
            "Keyboard simulation failed: CGEvent failed"
        );
    }

    #[test]
    fn test_clipboard_access_error_display_empty_message() {
        let error = ClipboardError::ClipboardAccess(String::new());
        assert_eq!(error.to_string(), "Clipboard access failed: ");
    }

    #[test]
    fn test_keyboard_simulation_error_display_unicode() {
        let error = ClipboardError::KeyboardSimulation("鍵盤模擬失敗".to_string());
        assert_eq!(
            error.to_string(),
            "Keyboard simulation failed: 鍵盤模擬失敗"
        );
    }

    // ============================================================
    // ClipboardError Serialize 測試
    // ============================================================

    #[test]
    fn test_clipboard_access_error_serialize() {
        let error = ClipboardError::ClipboardAccess("no clipboard".to_string());
        let json = serde_json::to_string(&error).unwrap();
        assert_eq!(json, "\"Clipboard access failed: no clipboard\"");
    }

    #[test]
    fn test_keyboard_simulation_error_serialize() {
        let error = ClipboardError::KeyboardSimulation("event creation failed".to_string());
        let json = serde_json::to_string(&error).unwrap();
        assert_eq!(
            json,
            "\"Keyboard simulation failed: event creation failed\""
        );
    }

    #[test]
    fn test_error_serialize_roundtrip_is_string() {
        // ClipboardError 序列化後應為純字串，非物件
        let error = ClipboardError::ClipboardAccess("test".to_string());
        let value: serde_json::Value = serde_json::to_value(&error).unwrap();
        assert!(value.is_string(), "序列化結果應為 JSON 字串，非物件");
    }

    // ============================================================
    // ClipboardError Debug trait 測試
    // ============================================================

    #[test]
    fn test_clipboard_error_debug_format() {
        let error = ClipboardError::ClipboardAccess("test".to_string());
        let debug_str = format!("{error:?}");
        assert!(debug_str.contains("ClipboardAccess"));
        assert!(debug_str.contains("test"));
    }

    #[test]
    fn test_keyboard_error_debug_format() {
        let error = ClipboardError::KeyboardSimulation("sim fail".to_string());
        let debug_str = format!("{error:?}");
        assert!(debug_str.contains("KeyboardSimulation"));
        assert!(debug_str.contains("sim fail"));
    }
}

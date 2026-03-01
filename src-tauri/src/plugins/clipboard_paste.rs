use arboard::Clipboard;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager, Runtime};

#[derive(Debug, thiserror::Error)]
pub enum ClipboardError {
    #[error("Clipboard access failed: {0}")]
    ClipboardAccess(String),
    #[error("Keyboard simulation failed: {0}")]
    #[allow(dead_code)]
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

/// Simulate Cmd+V using CGEvent (more reliable on macOS than enigo)
#[cfg(target_os = "macos")]
fn simulate_paste() -> Result<(), String> {
    use core_graphics::event::{CGEvent, CGEventFlags, CGKeyCode};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    // keycode 9 = 'v'
    const V_KEYCODE: CGKeyCode = 9;

    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
        .map_err(|_| "Failed to create CGEventSource")?;

    let key_down = CGEvent::new_keyboard_event(source.clone(), V_KEYCODE, true)
        .map_err(|_| "Failed to create key down event")?;
    key_down.set_flags(CGEventFlags::CGEventFlagCommand);

    let key_up = CGEvent::new_keyboard_event(source, V_KEYCODE, false)
        .map_err(|_| "Failed to create key up event")?;
    key_up.set_flags(CGEventFlags::CGEventFlagCommand);

    key_down.post(core_graphics::event::CGEventTapLocation::HID);
    key_up.post(core_graphics::event::CGEventTapLocation::HID);

    Ok(())
}

#[tauri::command]
pub fn paste_text<R: Runtime>(app: AppHandle<R>, text: String) -> Result<(), ClipboardError> {
    println!("[clipboard-paste] Pasting {} chars: \"{}\"", text.len(), text);

    // 1) Hide Tauri window so target app regains focus
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
        println!("[clipboard-paste] Window hidden");
    }

    // 2) Wait for OS to switch focus back
    thread::sleep(Duration::from_millis(200));

    // 3) Write text to clipboard
    let mut clipboard =
        Clipboard::new().map_err(|e| ClipboardError::ClipboardAccess(e.to_string()))?;

    clipboard
        .set_text(&text)
        .map_err(|e| ClipboardError::ClipboardAccess(e.to_string()))?;

    // 4) Verify clipboard was set
    match clipboard.get_text() {
        Ok(content) => println!("[clipboard-paste] Clipboard verified: \"{}\"", content),
        Err(e) => println!("[clipboard-paste] Clipboard verify failed: {}", e),
    }

    // 5) Wait for clipboard to settle
    thread::sleep(Duration::from_millis(50));

    // 6) Simulate Cmd+V via CGEvent
    #[cfg(target_os = "macos")]
    {
        match simulate_paste() {
            Ok(()) => println!("[clipboard-paste] Cmd+V sent via CGEvent"),
            Err(e) => {
                println!("[clipboard-paste] CGEvent paste failed: {}, skipping auto-paste", e);
            }
        }
    }

    // 7) Do NOT restore clipboard — keep transcribed text available for manual paste
    println!("[clipboard-paste] Done (clipboard NOT restored)");
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
        let debug_str = format!("{:?}", error);
        assert!(debug_str.contains("ClipboardAccess"));
        assert!(debug_str.contains("test"));
    }

    #[test]
    fn test_keyboard_error_debug_format() {
        let error = ClipboardError::KeyboardSimulation("sim fail".to_string());
        let debug_str = format!("{:?}", error);
        assert!(debug_str.contains("KeyboardSimulation"));
        assert!(debug_str.contains("sim fail"));
    }
}

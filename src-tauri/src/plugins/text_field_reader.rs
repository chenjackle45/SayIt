/// 讀取當前 focused text field 游標附近的文字。
/// macOS: 透過 AXUIElement Accessibility API
/// Windows: 目前為 no-op placeholder（後續補上 UI Automation）
#[tauri::command]
pub fn read_focused_text_field() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        macos::read_focused_text_field_impl()
    }

    #[cfg(target_os = "windows")]
    {
        // Windows UI Automation 實作延後，先回傳 None
        Ok(None)
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok(None)
    }
}

/// 讀取當前聚焦文字欄位中被選取（highlight）的文字。
/// 用於編輯模式偵測：有選取文字時進入編輯模式，語音變成指令。
/// macOS: 透過 AXSelectedText Accessibility 屬性
/// Windows: 目前為 no-op placeholder
#[tauri::command]
pub fn read_selected_text() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        macos::get_selected_text_impl()
    }

    #[cfg(target_os = "windows")]
    {
        Ok(None)
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok(None)
    }
}

// ========== macOS: AXUIElement ==========

#[cfg(target_os = "macos")]
mod macos {
    use core_foundation::base::{CFRelease, CFTypeRef, TCFType};
    use core_foundation::string::CFString;
    use std::ffi::c_void;
    use std::os::raw::c_int;

    type AXUIElementRef = CFTypeRef;
    type AXError = c_int;

    const K_AX_ERROR_SUCCESS: AXError = 0;

    // AX attribute name constants
    const K_AX_FOCUSED_APPLICATION_ATTRIBUTE: &str = "AXFocusedApplication";
    const K_AX_FOCUSED_UI_ELEMENT_ATTRIBUTE: &str = "AXFocusedUIElement";
    const K_AX_VALUE_ATTRIBUTE: &str = "AXValue";
    const K_AX_SELECTED_TEXT_RANGE_ATTRIBUTE: &str = "AXSelectedTextRange";
    const K_AX_ROLE_ATTRIBUTE: &str = "AXRole";
    const K_AX_SELECTED_TEXT_ATTRIBUTE: &str = "AXSelectedText";

    const CONTEXT_CHARS: usize = 50;
    const FALLBACK_CHARS: usize = 100;

    extern "C" {
        fn AXUIElementCreateSystemWide() -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFTypeRef,
            value: *mut CFTypeRef,
        ) -> AXError;
    }

    // CFRange struct for AXValue extraction
    #[repr(C)]
    #[derive(Debug, Clone, Copy)]
    struct CFRange {
        location: i64,
        length: i64,
    }

    extern "C" {
        fn AXValueGetValue(value: CFTypeRef, value_type: u32, value_ptr: *mut c_void) -> bool;
    }

    // kAXValueCFRangeType = 4
    const K_AX_VALUE_CF_RANGE_TYPE: u32 = 4;

    fn get_ax_attribute(element: AXUIElementRef, attribute_name: &str) -> Option<CFTypeRef> {
        let attr = CFString::new(attribute_name);
        let mut value: CFTypeRef = std::ptr::null();

        let err =
            unsafe { AXUIElementCopyAttributeValue(element, attr.as_CFTypeRef(), &mut value) };

        if err != K_AX_ERROR_SUCCESS || value.is_null() {
            None
        } else {
            Some(value)
        }
    }

    fn get_ax_string_attribute(element: AXUIElementRef, attribute_name: &str) -> Option<String> {
        let value = get_ax_attribute(element, attribute_name)?;
        let cf_string = unsafe { CFString::wrap_under_create_rule(value as *const _) };
        Some(cf_string.to_string())
    }

    fn get_cursor_position(element: AXUIElementRef) -> Option<usize> {
        let value = get_ax_attribute(element, K_AX_SELECTED_TEXT_RANGE_ATTRIBUTE)?;

        let mut range = CFRange {
            location: 0,
            length: 0,
        };

        let success = unsafe {
            AXValueGetValue(
                value,
                K_AX_VALUE_CF_RANGE_TYPE,
                &mut range as *mut CFRange as *mut c_void,
            )
        };

        unsafe { CFRelease(value) };

        if success && range.location >= 0 {
            Some(range.location as usize)
        } else {
            None
        }
    }

    fn extract_excerpt(full_text: &str, cursor_pos: Option<usize>, context: usize) -> String {
        let chars: Vec<char> = full_text.chars().collect();
        let len = chars.len();

        if len == 0 {
            return String::new();
        }

        let pos = match cursor_pos {
            Some(p) if p <= len => p,
            _ => {
                // fallback: 取末尾 FALLBACK_CHARS 字
                let start = len.saturating_sub(FALLBACK_CHARS);
                return chars[start..].iter().collect();
            }
        };

        let start = pos.saturating_sub(context);
        let end = (pos + context).min(len);

        chars[start..end].iter().collect()
    }

    fn is_text_input_role(role: &str) -> bool {
        matches!(
            role,
            "AXTextField" | "AXTextArea" | "AXComboBox" | "AXWebArea"
        )
    }

    /// AX 元素走訪結果。呼叫端負責讀取屬性後呼叫 `cleanup()` 釋放所有 CFTypeRef。
    struct FocusedElementContext {
        system_wide: AXUIElementRef,
        app: AXUIElementRef,
        element: AXUIElementRef,
        target_element: AXUIElementRef,
    }

    impl FocusedElementContext {
        fn cleanup(self) {
            unsafe {
                if self.target_element != self.element {
                    CFRelease(self.target_element);
                }
                CFRelease(self.element);
                CFRelease(self.app);
                CFRelease(self.system_wide);
            }
        }
    }

    /// 走訪 AX 樹取得當前聚焦的文字輸入元素。
    /// 共用邏輯：system-wide → focused app → focused element → role check → WebArea child。
    fn resolve_focused_text_element() -> Option<FocusedElementContext> {
        let system_wide = unsafe { AXUIElementCreateSystemWide() };
        if system_wide.is_null() {
            return None;
        }

        let app = match get_ax_attribute(system_wide, K_AX_FOCUSED_APPLICATION_ATTRIBUTE) {
            Some(a) => a,
            None => {
                unsafe { CFRelease(system_wide) };
                return None;
            }
        };

        let element = match get_ax_attribute(app, K_AX_FOCUSED_UI_ELEMENT_ATTRIBUTE) {
            Some(e) => e,
            None => {
                unsafe {
                    CFRelease(app);
                    CFRelease(system_wide);
                }
                return None;
            }
        };

        let role = get_ax_string_attribute(element, K_AX_ROLE_ATTRIBUTE);
        let target_element = match role.as_deref() {
            Some(r) if is_text_input_role(r) => {
                if r == "AXWebArea" {
                    match get_ax_attribute(element, K_AX_FOCUSED_UI_ELEMENT_ATTRIBUTE) {
                        Some(child) => child,
                        None => element,
                    }
                } else {
                    element
                }
            }
            _ => {
                unsafe {
                    CFRelease(element);
                    CFRelease(app);
                    CFRelease(system_wide);
                }
                return None;
            }
        };

        Some(FocusedElementContext {
            system_wide,
            app,
            element,
            target_element,
        })
    }

    pub fn read_focused_text_field_impl() -> Result<Option<String>, String> {
        let ctx = match resolve_focused_text_element() {
            Some(c) => c,
            None => return Ok(None),
        };

        let cursor_pos = get_cursor_position(ctx.target_element);
        let full_text = get_ax_string_attribute(ctx.target_element, K_AX_VALUE_ATTRIBUTE);
        ctx.cleanup();

        match full_text {
            Some(text) if !text.is_empty() => {
                let excerpt = extract_excerpt(&text, cursor_pos, CONTEXT_CHARS);
                if excerpt.is_empty() {
                    Ok(None)
                } else {
                    Ok(Some(excerpt))
                }
            }
            _ => Ok(None),
        }
    }

    pub fn get_selected_text_impl() -> Result<Option<String>, String> {
        let ctx = match resolve_focused_text_element() {
            Some(c) => c,
            None => return Ok(None),
        };

        let selected_text =
            get_ax_string_attribute(ctx.target_element, K_AX_SELECTED_TEXT_ATTRIBUTE);
        ctx.cleanup();

        match selected_text {
            Some(text) if !text.is_empty() => Ok(Some(text)),
            _ => Ok(None),
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn test_extract_excerpt_empty() {
            assert_eq!(extract_excerpt("", None, 50), "");
        }

        #[test]
        fn test_extract_excerpt_short_text() {
            let text = "Hello world";
            let result = extract_excerpt(text, Some(5), 50);
            assert_eq!(result, "Hello world");
        }

        #[test]
        fn test_extract_excerpt_cursor_in_middle() {
            let text: String = (0..200)
                .map(|i| char::from(b'a' + (i % 26) as u8))
                .collect();
            let result = extract_excerpt(&text, Some(100), 50);
            assert_eq!(result.chars().count(), 100); // 50 before + 50 after
        }

        #[test]
        fn test_extract_excerpt_cursor_at_start() {
            let text: String = (0..200)
                .map(|i| char::from(b'a' + (i % 26) as u8))
                .collect();
            let result = extract_excerpt(&text, Some(0), 50);
            assert_eq!(result.chars().count(), 50); // 0 before + 50 after
        }

        #[test]
        fn test_extract_excerpt_cursor_at_end() {
            let text: String = (0..200)
                .map(|i| char::from(b'a' + (i % 26) as u8))
                .collect();
            let result = extract_excerpt(&text, Some(200), 50);
            assert_eq!(result.chars().count(), 50); // 50 before + 0 after
        }

        #[test]
        fn test_extract_excerpt_no_cursor_fallback() {
            let text: String = (0..200)
                .map(|i| char::from(b'a' + (i % 26) as u8))
                .collect();
            let result = extract_excerpt(&text, None, 50);
            assert_eq!(result.chars().count(), 100); // fallback last 100 chars
        }

        #[test]
        fn test_extract_excerpt_cjk_characters() {
            let text =
                "這是一段很長的中文測試文字，用來驗證游標附近截取功能是否正確處理多位元組字元";
            let result = extract_excerpt(text, Some(10), 5);
            assert_eq!(result.chars().count(), 10); // 5 before + 5 after
        }

        #[test]
        fn test_is_text_input_role() {
            assert!(is_text_input_role("AXTextField"));
            assert!(is_text_input_role("AXTextArea"));
            assert!(is_text_input_role("AXComboBox"));
            assert!(is_text_input_role("AXWebArea"));
            assert!(!is_text_input_role("AXButton"));
            assert!(!is_text_input_role("AXStaticText"));
        }
    }
}

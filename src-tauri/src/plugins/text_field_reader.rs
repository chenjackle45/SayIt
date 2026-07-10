/// 讀取當前 focused text field 游標附近的文字。
/// macOS: 透過 AXUIElement Accessibility API。
/// Windows: 透過 UI Automation（IUIAutomation + TextPattern/ValuePattern，跑在專用 MTA 執行緒）。
///
/// 契約：回傳「游標附近、有上限」的文字（非整份文件）；讀不到一律回 `Ok(None)`。
#[tauri::command]
pub fn read_focused_text_field() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        macos::read_focused_text_field_impl()
    }

    #[cfg(target_os = "windows")]
    {
        windows_impl::read_focused_text_field_impl()
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok(None)
    }
}

/// 讀取當前聚焦文字欄位中被選取（highlight）的文字。
/// 編輯模式的「剪貼簿後備」路徑：僅在 `read_selection_state` 回報
/// unavailable（AX 不可見的 App）時、於錄音停止且按鍵放開後由前端呼叫。
/// 透過模擬 Cmd+C / Ctrl+C 擷取剪貼簿內容。
#[tauri::command]
pub fn read_selected_text() -> Result<Option<String>, String> {
    super::clipboard_paste::capture_selected_text_via_clipboard()
}

/// 選取狀態偵測結果（#24/#25 編輯模式判定）。
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SelectionState {
    /// "selection" | "noSelection" | "unavailable"
    pub kind: String,
    pub text: Option<String>,
}

impl SelectionState {
    // selection / no_selection 僅 macOS 的 AX 分類器使用；
    // Windows 端一律 unavailable，cfg 閘避免 dead_code 撞上 clippy -D warnings
    #[cfg(target_os = "macos")]
    fn selection(text: String) -> Self {
        Self {
            kind: "selection".to_string(),
            text: Some(text),
        }
    }
    #[cfg(target_os = "macos")]
    fn no_selection() -> Self {
        Self {
            kind: "noSelection".to_string(),
            text: None,
        }
    }
    fn unavailable() -> Self {
        Self {
            kind: "unavailable".to_string(),
            text: None,
        }
    }
}

/// 讀取聚焦文字欄位的選取狀態——編輯模式判定的主路徑。
/// macOS：AX 被動查詢（零按鍵模擬，#25 的字元污染在此路徑不可能發生）。三態：
///   selection    — 確定有選取，text 為選取內容 → 前端直接進編輯模式
///   noSelection  — 確定無選取（AX 可讀且長度 0）→ 一般聽寫，
///                  CodeMirror 類編輯器的「無選取複製整行」誤判（#24）在此被排除
///   unavailable  — AX 不可見或讀值失真（Heptabase/LINE 類）→ 前端在錄音停止、
///                  按鍵放開後改走剪貼簿後備（read_selected_text）
/// Windows / 其他平台：一律 unavailable（沿用剪貼簿後備；選取讀取待 UIA 版補上）。
#[tauri::command]
pub fn read_selection_state() -> SelectionState {
    #[cfg(target_os = "macos")]
    {
        macos::read_selection_state_impl()
    }

    #[cfg(not(target_os = "macos"))]
    {
        SelectionState::unavailable()
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
    const K_AX_SELECTED_TEXT_ATTRIBUTE: &str = "AXSelectedText";
    const K_AX_ROLE_ATTRIBUTE: &str = "AXRole";

    const CONTEXT_CHARS: usize = 50;
    const FALLBACK_CHARS: usize = 100;

    /// 選取狀態讀取的總 timeout：AX 是同步跨進程呼叫，目標 App 卡死會阻塞
    /// （對齊 windows_impl 的守衛設計）。上限涵蓋「解析失敗 → 戳醒 Electron →
    /// 等樹重建 → 重試」的最長路徑。
    const SELECTION_READ_TIMEOUT_MS: u64 = 600;
    /// 對 Electron 施加 AXManualAccessibility 後等樹重建的時間。
    const POKE_SETTLE_MS: u64 = 150;

    extern "C" {
        fn AXUIElementCreateSystemWide() -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFTypeRef,
            value: *mut CFTypeRef,
        ) -> AXError;
        fn AXUIElementSetAttributeValue(
            element: AXUIElementRef,
            attribute: CFTypeRef,
            value: CFTypeRef,
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

    /// 讀取 AXSelectedTextRange 並解出 CFRange（游標位置 + 選取長度的共用來源）。
    fn read_selected_text_range(element: AXUIElementRef) -> Option<CFRange> {
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

        if success {
            Some(range)
        } else {
            None
        }
    }

    fn get_cursor_position(element: AXUIElementRef) -> Option<usize> {
        let range = read_selected_text_range(element)?;
        if range.location >= 0 {
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

    // ========== 選取狀態偵測（#24/#25 編輯模式判定） ==========

    use super::SelectionState;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
    use std::sync::{Mutex, OnceLock};
    use std::time::Duration;

    type SelectionRespTx = SyncSender<SelectionState>;

    static SELECTION_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
    static SELECTION_WORKER: OnceLock<Option<Mutex<SyncSender<SelectionRespTx>>>> = OnceLock::new();

    /// 讀取聚焦元素的選取長度（AXSelectedTextRange.length）。
    /// length > 0 = 真的有選取；length == 0 = 只有游標、沒選取
    /// （編輯器「無選取時 Cmd+C 複製整行」不影響 AX 層的選取範圍，故能分辨）。
    fn get_selection_length(element: AXUIElementRef) -> Option<i64> {
        read_selected_text_range(element).map(|range| range.length)
    }

    /// Electron/Chromium 的無障礙樹是惰性啟用的：對焦點 App 設
    /// AXManualAccessibility=true 可強制喚醒完整樹（Electron 官方支援的旗標）。
    /// 對原生 App 設此屬性會失敗，無副作用。
    fn poke_focused_app_manual_accessibility() {
        let system_wide = unsafe { AXUIElementCreateSystemWide() };
        if system_wide.is_null() {
            return;
        }
        if let Some(app) = get_ax_attribute(system_wide, K_AX_FOCUSED_APPLICATION_ATTRIBUTE) {
            let attr = CFString::new("AXManualAccessibility");
            let value = core_foundation::boolean::CFBoolean::true_value();
            unsafe {
                AXUIElementSetAttributeValue(app, attr.as_CFTypeRef(), value.as_CFTypeRef());
                CFRelease(app);
            }
        }
        unsafe { CFRelease(system_wide) };
    }

    /// 依已解析的聚焦文字元素分類選取狀態。消耗 ctx 並負責釋放。
    fn classify_selection(ctx: FocusedElementContext) -> SelectionState {
        let state = match get_selection_length(ctx.target_element) {
            Some(len) if len > 0 => {
                match get_ax_string_attribute(ctx.target_element, K_AX_SELECTED_TEXT_ATTRIBUTE) {
                    Some(text) if !text.trim().is_empty() => SelectionState::selection(text),
                    // 長度 > 0 但文字讀不到/為空 = 橋接失真（Electron 已知失效模式），
                    // 交給剪貼簿後備嘗試撈回真實選取
                    _ => SelectionState::unavailable(),
                }
            }
            Some(_) => SelectionState::no_selection(),
            // 元素是文字輸入類但範圍屬性不支援 → 無法判定
            None => SelectionState::unavailable(),
        };
        ctx.cleanup();
        state
    }

    /// 阻塞式選取偵測：第一次解析失敗時戳醒 Electron 樹再試一次。
    /// 全程只做被動 AX 查詢，不模擬任何按鍵。
    fn selection_probe_blocking() -> SelectionState {
        if let Some(ctx) = resolve_focused_text_element() {
            return classify_selection(ctx);
        }
        poke_focused_app_manual_accessibility();
        std::thread::sleep(Duration::from_millis(POKE_SETTLE_MS));
        match resolve_focused_text_element() {
            Some(ctx) => classify_selection(ctx),
            None => SelectionState::unavailable(),
        }
    }

    /// 入口：AX 讀取跑在單一常駐 worker 執行緒上、最多等 SELECTION_READ_TIMEOUT_MS
    /// （AX 為同步跨進程呼叫，目標 App 卡死不可拖住 command thread——
    /// 對齊 windows_impl 的守衛模式；常駐而非每次 spawn，卡死時最多損失
    /// 一條執行緒、不會隨熱鍵次數無上界累積）。逾時 / 忙碌一律回 unavailable，
    /// 由前端剪貼簿後備接手。
    pub fn read_selection_state_impl() -> SelectionState {
        let sender = match selection_worker_sender() {
            Some(s) => s,
            None => return SelectionState::unavailable(),
        };

        // single-flight：熱鍵連按時避免 AX 讀取堆疊。
        // 旗標由「呼叫端」在所有路徑後無條件清掉，不依賴 worker
        // （worker 卡死時遲到結果只會送進已 drop 的 receiver 而被丟棄）
        if SELECTION_IN_FLIGHT.swap(true, Ordering::AcqRel) {
            return SelectionState::unavailable();
        }

        let outcome = selection_read_once(&sender);
        SELECTION_IN_FLIGHT.store(false, Ordering::Release);
        outcome
    }

    fn selection_read_once(sender: &SyncSender<SelectionRespTx>) -> SelectionState {
        let (resp_tx, resp_rx) = sync_channel::<SelectionState>(1);
        if sender.try_send(resp_tx).is_err() {
            // worker 還卡在上一個請求（目標 App 的 AX server 無回應）
            return SelectionState::unavailable();
        }
        resp_rx
            .recv_timeout(Duration::from_millis(SELECTION_READ_TIMEOUT_MS))
            .unwrap_or_else(|_| SelectionState::unavailable())
    }

    fn selection_worker_sender() -> Option<SyncSender<SelectionRespTx>> {
        let cell = SELECTION_WORKER.get_or_init(spawn_selection_worker);
        let mutex = cell.as_ref()?;
        let guard = mutex.lock().ok()?;
        Some(guard.clone())
    }

    fn spawn_selection_worker() -> Option<Mutex<SyncSender<SelectionRespTx>>> {
        let (req_tx, req_rx) = sync_channel::<SelectionRespTx>(1);
        std::thread::Builder::new()
            .name("ax-selection-reader".into())
            .spawn(move || selection_worker_loop(req_rx))
            .ok()?;
        Some(Mutex::new(req_tx))
    }

    fn selection_worker_loop(req_rx: Receiver<SelectionRespTx>) {
        while let Ok(resp_tx) = req_rx.recv() {
            let result = selection_probe_blocking();
            // 呼叫端可能已逾時離開（receiver drop）：try_send 失敗直接丟棄
            let _ = resp_tx.try_send(result);
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

// ========== Windows: UI Automation ==========

#[cfg(target_os = "windows")]
mod windows_impl {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
    use std::sync::{Mutex, OnceLock};
    use std::time::Duration;

    use windows::core::BOOL;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationTextPattern,
        IUIAutomationTextPattern2, IUIAutomationTextRange, IUIAutomationValuePattern,
        TextPatternRangeEndpoint_End, TextPatternRangeEndpoint_Start, TextUnit_Character,
        UIA_TextPattern2Id, UIA_TextPatternId, UIA_ValuePatternId,
    };

    /// 游標前後各取的字數（對齊 macOS CONTEXT_CHARS）。
    const CONTEXT_CHARS: i32 = 50;
    /// TextPattern GetText 上限＝游標前後 excerpt 寬度（caret ± CONTEXT_CHARS）。
    /// 設成 excerpt 寬度，確保即使 provider 未照 MoveEndpointByUnit 收斂，
    /// 回傳的仍是「從 range 起點（caret 前緣）」起算的 caret 區段，不會被 cap_tail 從尾端截掉。
    const GET_TEXT_CAP: i32 = CONTEXT_CHARS * 2;
    /// ValuePattern 整欄值 fallback 的字元上限（隱私 / 成本保護）。
    const MAX_VALUE_CHARS: usize = 600;
    /// 單次 UIA 讀取 timeout，需小於前端輪詢間隔（500ms），避免阻塞 command thread。
    const READ_TIMEOUT_MS: u64 = 250;

    type RespTx = SyncSender<Option<String>>;

    static IN_FLIGHT: AtomicBool = AtomicBool::new(false);
    static WORKER: OnceLock<Option<Mutex<SyncSender<RespTx>>>> = OnceLock::new();

    /// 入口：把讀取請求送到專用 UIA 執行緒，最多等 `READ_TIMEOUT_MS`。
    /// 任何失敗 / 逾時 / 忙碌一律回 `Ok(None)`（與 macOS 一致，靜默降級）。
    ///
    /// 契約：回傳游標附近「有上限」的文字（TextPattern excerpt ≤ ~100 字，
    /// 或 ValuePattern 整欄值 ≤ `MAX_VALUE_CHARS` 字），絕不回傳整份文件。
    pub fn read_focused_text_field_impl() -> Result<Option<String>, String> {
        let sender = match worker_sender() {
            Some(s) => s,
            None => return Ok(None),
        };

        // single-flight：已有讀取進行中就放棄這次，避免輪詢呼叫堆疊阻塞。
        if IN_FLIGHT.swap(true, Ordering::AcqRel) {
            return Ok(None);
        }

        // 由「呼叫端」在所有路徑（成功 / 逾時 / 送出失敗）後清掉 IN_FLIGHT，
        // 不依賴 worker 清旗標：若某次 UIA 呼叫永久卡死、worker 回不來，
        // 旗標才不會永久卡 true 而使功能靜默失效。每次呼叫各有獨立 oneshot
        // channel，卡死 worker 的遲到結果只會送進已 drop 的 receiver 而被丟棄。
        let outcome = read_once(&sender);
        IN_FLIGHT.store(false, Ordering::Release);
        Ok(outcome)
    }

    /// 送一次讀取請求並等 `READ_TIMEOUT_MS`；逾時 / 送出失敗一律回 `None`。
    fn read_once(sender: &SyncSender<RespTx>) -> Option<String> {
        let (resp_tx, resp_rx) = sync_channel::<Option<String>>(1);
        if sender.try_send(resp_tx).is_err() {
            return None;
        }
        resp_rx
            .recv_timeout(Duration::from_millis(READ_TIMEOUT_MS))
            .unwrap_or(None)
    }

    fn worker_sender() -> Option<SyncSender<RespTx>> {
        let cell = WORKER.get_or_init(spawn_worker);
        let mutex = cell.as_ref()?;
        let guard = mutex.lock().ok()?;
        Some(guard.clone())
    }

    /// 啟動長壽 MTA 執行緒，內含快取的 `IUIAutomation`。
    /// 回傳 `None` 代表 COM / UIA 初始化失敗（此平台功能等同 no-op）。
    fn spawn_worker() -> Option<Mutex<SyncSender<RespTx>>> {
        let (req_tx, req_rx) = sync_channel::<RespTx>(1);
        let (ready_tx, ready_rx) = sync_channel::<bool>(0);

        std::thread::Builder::new()
            .name("uia-reader".into())
            .spawn(move || worker_loop(req_rx, ready_tx))
            .ok()?;

        match ready_rx.recv() {
            Ok(true) => Some(Mutex::new(req_tx)),
            _ => None,
        }
    }

    fn worker_loop(req_rx: Receiver<RespTx>, ready_tx: SyncSender<bool>) {
        // 此執行緒專用 MTA COM，存活整個 process 生命週期；COM 物件不跨執行緒傳遞。
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }

        let automation: IUIAutomation =
            match unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_ALL) } {
                Ok(a) => a,
                Err(_) => {
                    let _ = ready_tx.send(false);
                    unsafe { CoUninitialize() };
                    return;
                }
            };

        let _ = ready_tx.send(true);

        while let Ok(resp_tx) = req_rx.recv() {
            let result = read_excerpt(&automation);
            // 即使呼叫端已逾時離開（receiver 被 drop）也不阻塞；IN_FLIGHT 由呼叫端清。
            let _ = resp_tx.try_send(result);
        }

        unsafe { CoUninitialize() };
    }

    /// 讀取目前聚焦元素游標附近文字。全程在 worker 執行緒上跑。
    fn read_excerpt(automation: &IUIAutomation) -> Option<String> {
        let element = unsafe { automation.GetFocusedElement() }.ok()?;

        // 隱私保護：聚焦在密碼 / 受保護欄位時不讀取，避免把密碼 / token / API key 送 LLM。
        if is_password_element(&element) {
            return None;
        }

        // 1) 優先：TextPattern 游標附近 excerpt（涵蓋 contenteditable，如 Teams / 文件編輯器）。
        if let Some(text) = read_via_text_pattern(&element) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(cap_tail(trimmed, (CONTEXT_CHARS as usize) * 2));
            }
        }

        // 2) Fallback：ValuePattern 整欄值（涵蓋原生 input / textarea），capped。
        if let Some(text) = read_via_value_pattern(&element) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(cap_tail(trimmed, MAX_VALUE_CHARS));
            }
        }

        None
    }

    /// 聚焦元素是否為密碼 / 受保護欄位（讀不到屬性時保守視為「是」→ fail-closed，
    /// 對未正確暴露 IsPassword 的第三方欄位較安全，避免把可能的密碼 / token 送 LLM）。
    fn is_password_element(element: &IUIAutomationElement) -> bool {
        unsafe { element.CurrentIsPassword() }
            .map(|b| b.as_bool())
            .unwrap_or(true)
    }

    fn read_via_text_pattern(element: &IUIAutomationElement) -> Option<String> {
        let range = caret_range(element)?;
        unsafe {
            let _ = range.MoveEndpointByUnit(
                TextPatternRangeEndpoint_Start,
                TextUnit_Character,
                -CONTEXT_CHARS,
            );
            let _ = range.MoveEndpointByUnit(
                TextPatternRangeEndpoint_End,
                TextUnit_Character,
                CONTEXT_CHARS,
            );
            let bstr = range.GetText(GET_TEXT_CAP).ok()?;
            Some(bstr.to_string())
        }
    }

    /// 取得游標 range：先試 `TextPattern2.GetCaretRange`，再 fallback 到 `TextPattern.GetSelection()[0]`。
    fn caret_range(element: &IUIAutomationElement) -> Option<IUIAutomationTextRange> {
        unsafe {
            if let Ok(tp2) =
                element.GetCurrentPatternAs::<IUIAutomationTextPattern2>(UIA_TextPattern2Id)
            {
                let mut is_active = BOOL(0);
                if let Ok(range) = tp2.GetCaretRange(&mut is_active) {
                    return Some(range);
                }
            }

            if let Ok(tp) =
                element.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
            {
                if let Ok(selection) = tp.GetSelection() {
                    if matches!(selection.Length(), Ok(len) if len > 0) {
                        if let Ok(range) = selection.GetElement(0) {
                            return Some(range);
                        }
                    }
                }
            }

            None
        }
    }

    fn read_via_value_pattern(element: &IUIAutomationElement) -> Option<String> {
        unsafe {
            let value_pattern = element
                .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
                .ok()?;
            let bstr = value_pattern.CurrentValue().ok()?;
            Some(bstr.to_string())
        }
    }

    /// 取字串末尾最多 `max` 個字元（以 char 計，CJK 安全）。
    fn cap_tail(s: &str, max: usize) -> String {
        let chars: Vec<char> = s.chars().collect();
        if chars.len() <= max {
            s.to_string()
        } else {
            chars[chars.len() - max..].iter().collect()
        }
    }

    #[cfg(test)]
    mod tests {
        use super::cap_tail;

        #[test]
        fn test_cap_tail_shorter_than_max() {
            assert_eq!(cap_tail("hello", 10), "hello");
        }

        #[test]
        fn test_cap_tail_equal_to_max() {
            assert_eq!(cap_tail("hello", 5), "hello");
        }

        #[test]
        fn test_cap_tail_keeps_tail() {
            assert_eq!(cap_tail("abcdefghij", 3), "hij");
        }

        #[test]
        fn test_cap_tail_cjk() {
            let s = "這是一段中文測試文字";
            assert_eq!(cap_tail(s, 4), "測試文字");
            assert_eq!(cap_tail(s, 4).chars().count(), 4);
        }

        #[test]
        fn test_cap_tail_empty() {
            assert_eq!(cap_tail("", 5), "");
        }
    }
}

---
paths:
  - src-tauri/src/plugins/hotkey_listener.rs
  - src-tauri/src/plugins/clipboard_paste.rs
  - src-tauri/src/plugins/text_field_reader.rs
  - src-tauri/src/plugins/keyboard_monitor.rs
---

# Windows 平台規則（鍵盤 hook、貼上、選取探測）

> 2026-09-11 自 `CLAUDE.md` 搬入「鍵盤 Hook 注意事項」，並補上 v0.12.0 貼上回歸修法的約束。

## 鍵盤 Hook

- **Copilot 鍵 = `VK_F23` (`0x86`)（硬規則）**：低階鍵盤 hook（`mod windows_hook` 在 `src-tauri/src/plugins/hotkey_listener.rs`）必須在取出 `kbd` 後立刻判斷 `if kbd.vkCode == VK_F23 { return CallNextHookEx(...); }` 把信號放行，否則會干擾 Windows 11 Copilot Quick View。**禁止把 F23 開放成 SayIt 自訂熱鍵**。詳見 [`docs/adr-windows-vk-f23.md`](../../docs/adr-windows-vk-f23.md)
- **macOS 本地 `cargo check` 無法驗證 Windows 鍵盤 hook**：`#[cfg(target_os = "windows")]` 區塊在 macOS 不編譯，必須靠 CI 的 windows runner 或實機測試
- **`windows` crate 0.61 breaking change**：`AttachThreadInput` 從 `Win32::UI::Input::KeyboardAndMouse` 搬到 `Win32::System::Threading`，Cargo.toml features 需含 `Win32_System_Threading`

## 貼上與選取探測（v0.12.0 起）

- Windows 貼上走 `simulate_paste_via_keyboard()`（SendInput Ctrl+V）；macOS 走 CGEvent Cmd+V
- `read_selection_state` 的 Windows 分支**在錄音開始時就做剪貼簿探測**（`capture_selected_text_via_clipboard()`）：有文字回 `selection`、其餘回 `no_selection`，**不回 `unavailable`**。這是 #70／#72（v0.11.0 瀏覽器不自動貼上）的修法，還原 v0.10.0 序列；候選成因是「觸發鍵放開後才送 Ctrl+C，瀏覽器把單獨放開的 Alt 當選單鍵」。**改動這段時序等於重開 #70／#72**，要先看那兩串的實測結論
- 已知代價：Windows 上「無選取時 Ctrl+C 複製整行」的編輯器（#73 HackMD）誤判率回到 v0.10.0 水準；升級 UIA 讀取是內部待辦、無對外承諾
- **自家 SendInput 一律帶 `SAYIT_INJECTED_EXTRA_INFO`**（v0.12.1 起，`clipboard_paste.rs`）：`hotkey_listener.rs` 的 hook 在 F23 放行之後、任何狀態處理之前，看到這個 `dwExtraInfo` 就 `CallNextHookEx`。理由：v0.12.0 錄音開始的模擬 Ctrl↓／Ctrl↑ 到 hook 時 `vkCode` 是 `VK_LCONTROL`，左 Ctrl 觸發鍵每次錄音都被立刻停掉。新增任何 `SendInput` 都要走 `build_ctrl_chord_inputs()` 或同樣填記號；**不要改成過濾 `LLKHF_INJECTED`**，那會讓改鍵工具（AutoHotkey／PowerToys）的使用者觸發鍵失效。計畫：`docs/plan-windows-injected-key-guard.md`
- `selection`／`no_selection` 建構函式 cfg 為 `any(macos, windows)`，`unavailable` 為 `not(windows)`，避免 clippy `-D warnings` 的 dead_code

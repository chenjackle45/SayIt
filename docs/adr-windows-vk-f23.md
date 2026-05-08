# ADR: Windows Copilot 鍵 (`VK_F23`) 在低階鍵盤 hook 強制 early-return

| 項目 | 內容 |
|------|------|
| 狀態 | Accepted |
| 決議日期 | 2026-05-04 |
| 引入版本 | v0.9.5 之後（PR [#29](https://github.com/chenjackle45/SayIt/pull/29)） |
| 影響範圍 | Windows 平台、低階鍵盤 hook |
| 程式碼位置 | `src-tauri/src/plugins/hotkey_listener.rs` 之 `mod windows_hook` |

## Context

Windows 11 引入「Copilot 實體鍵」（部分鍵盤實體上有 Copilot 圖示按鍵）。實體鍵按下時系統送出 `VK_F23` virtual-key code（`0x86`），由 Microsoft 保留供系統喚起 Copilot Quick View。

SayIt 使用 Win32 低階鍵盤 hook（`SetWindowsHookExW(WH_KEYBOARD_LL)`）攔截全域鍵盤事件以偵測自訂熱鍵與修飾鍵狀態。預設情況下，hook 程序會把所有 `KBDLLHOOKSTRUCT` 事件交給 SayIt 的偵測邏輯處理，再透過 `CallNextHookEx` 傳給下一個 hook。

社群回報：在 SayIt 開啟時，按 Copilot 實體鍵無反應，Windows 11 Quick View 無法喚起。根因是 SayIt 的 hook 在處理 `VK_F23` 時干擾了系統 Copilot 鍵事件鏈。

## Decision

在 `windows_hook::hook_proc` 取出 `KBDLLHOOKSTRUCT` 結構之後、執行任何 SayIt 偵測邏輯之前，立刻判斷 `kbd.vkCode == VK_F23` 並 early-return：

```rust
let kbd = *(l_param.0 as *const KBDLLHOOKSTRUCT);
// Ignore Copilot's dedicated VK_F23 signal to avoid interfering with Quick View.
if kbd.vkCode == VK_F23 {
    return CallNextHookEx(None, n_code, w_param, l_param);
}
```

並把 `0x86` 抽成具名常數 `const VK_F23: u32 = 0x86;` 與其他 Windows VK 常數並列。

## Consequences

### 正面

- **Copilot 鍵恢復正常運作**：Windows 11 Quick View 不再被 SayIt 干擾。
- **與 Microsoft 系統標準對齊**：保留系統保留鍵碼的原始語意。
- **效能微優**：early-return 跳過後續所有 modifier / hotkey 偵測邏輯。

### 負面

- **F23 不可作為 SayIt 自訂熱鍵（刻意 trade-off）**：使用者無法在熱鍵設定中綁定 F23。實務上幾乎無影響，因為：
  - 傳統鍵盤沒有 F23 鍵
  - Microsoft 已將 VK_F23 保留給 Copilot
  - SayIt 主流熱鍵是 Fn / Ctrl / Alt 等常見鍵
- **Windows-only 行為，macOS 本機 `cargo check` 無法驗證**：必須靠 CI windows runner 或實機測試。

## Alternatives Considered

| 方案 | 結論 |
|------|------|
| 不處理，留下原行為 | ❌ 會持續干擾 Windows 11 Copilot 鍵，社群會持續回報 |
| 把 VK_F23 加入「忽略 VK 集合」(`HashSet<u32>`) 集中管理 | ❌ 目前只有單一忽略項，硬編碼判斷反而清晰；過度抽象不符合 SayIt「不為假設未來需求設計」原則 |
| 條件性忽略（僅當系統 Copilot 啟用時）| ❌ 偵測 Copilot 啟用狀態複雜且不穩定；保險起見一律忽略 |
| 使用 `pull_request_target` 等 workflow 層方案 | ❌ 與本決策無關（這是 hook 層問題） |

## References

- [Windows Virtual-Key Codes](https://learn.microsoft.com/en-us/windows/win32/inputdev/virtual-key-codes)
- PR #29: https://github.com/chenjackle45/SayIt/pull/29
- Memory: `windows-platform-quirks.md`

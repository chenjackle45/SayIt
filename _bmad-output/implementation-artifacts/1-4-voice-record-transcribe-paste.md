# Story 1.4: 語音錄音→轉錄→貼上完整流程

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 使用者,
I want 按住熱鍵說話後，語音自動轉為文字並貼入游標位置,
So that 我能在任何應用程式中用語音取代打字。

## Acceptance Criteria

1. **Hold 模式錄音→轉錄→貼上** — API Key 已設定且熱鍵系統運作中。使用者按住觸發鍵（Hold 模式）時，系統透過 `navigator.mediaDevices.getUserMedia()` 開始麥克風錄音。useVoiceFlowStore 狀態更新為 `'recording'`，發送 `voice-flow:state-changed` 事件 `{ status: 'recording' }`。使用者放開觸發鍵時，MediaRecorder 停止錄音並產生音訊 blob，音訊封裝為 Groq Whisper API 可接受的格式（multipart/form-data），狀態更新為 `'transcribing'`。

2. **Groq Whisper API 轉錄** — 音訊送至 Groq Whisper API（model: whisper-large-v3, language: zh），取得繁體中文轉錄結果。API 請求透過 HTTPS 傳送。API Key 從 useSettingsStore 取得。

3. **自動貼上至游標位置** — 轉錄結果取得後，系統呼叫 `invoke('paste_text', { text })` 將文字貼入。clipboard_paste.rs 將文字寫入系統剪貼簿並模擬 Cmd+V（macOS）或 Ctrl+V（Windows）執行貼上。文字出現在當前游標所在的應用程式中。useVoiceFlowStore 狀態更新為 `'success'`。

4. **Toggle 模式支援** — Toggle 模式啟用時，使用者按一下觸發鍵開始錄音，再按一下停止。錄音→轉錄→貼上流程與 Hold 模式相同。

5. **API 錯誤處理** — Groq Whisper API 請求失敗（網路斷線、API 錯誤等），API 回應非 200 或網路超時時，useVoiceFlowStore 狀態更新為 `'error'`，發送 `voice-flow:state-changed` 事件 `{ status: 'error', message: '人類可讀錯誤訊息' }`。不執行貼上動作。App 回到 idle 狀態，可立即重試。

6. **useVoiceFlow 遷移至 useVoiceFlowStore** — 現有 `useVoiceFlow.ts` composable 的錄音/轉錄/貼上流程邏輯遷移至 `useVoiceFlowStore`（Pinia store）驅動。現有 `useHudState.ts` 的視窗顯示/隱藏和 auto-hide timer 邏輯整合至 store。`App.vue` 改為使用 `useVoiceFlowStore`。舊 composables 邏輯被 store 完全取代後移除。

## Tasks / Subtasks

- [x] Task 1: 擴展 useVoiceFlowStore 為完整流程引擎 (AC: #1, #2, #3, #4, #5, #6)
  - [x] 1.1 在 `useVoiceFlowStore.ts` 新增內部狀態：
    - `isRecording: ref<boolean>(false)` — 防止重複觸發
    - `recordingStartTime: ref<number>(0)` — 錄音開始時間戳（`performance.now()`）
    - `autoHideTimer: ReturnType<typeof setTimeout> | null` — auto-hide 計時器（非 ref，不需響應式）
    - `unlistenFunctions: UnlistenFn[]` — 事件監聽解除函式陣列
  - [x] 1.2 將 `useHudState.ts` 的視窗管理邏輯移入 store：
    - `showHud()` — `getCurrentWindow().show()` + `setIgnoreCursorEvents(true)`（讓滑鼠穿透 HUD，不搶目標應用焦點）
    - `hideHud()` — `getCurrentWindow().hide()`
    - 擴展既有 `transitionTo()` — 加入計時器管理 + 視窗顯示/隱藏副作用：
      - `idle` → `hideHud()`
      - `recording` / `transcribing` → `showHud()`
      - `success` → `showHud()` → 1000ms 後 `transitionTo('idle')`
      - `error` → `showHud()` → 2000ms 後 `transitionTo('idle')`
    - 每次 `transitionTo()` 先清除既有 `autoHideTimer`
  - [x] 1.3 新增 `initialize()` action（遷移自 `useVoiceFlow.ts`）：
    - 呼叫 `settingsStore.loadSettings()` 確保設定已載入（含 API Key、hotkey 設定）
    - 呼叫 `initializeMicrophone()` from `lib/recorder.ts`
    - 註冊 Tauri 事件監聽（使用 `useTauriEvents.ts` 的常數）：
      - `HOTKEY_PRESSED` → `handleStartRecording()`
      - `HOTKEY_RELEASED` → `handleStopRecording()`
      - `HOTKEY_TOGGLED` → 根據 `payload.action` 呼叫 start/stop
      - `HOTKEY_ERROR` → `transitionTo('error', payload.message)`
    - 將所有 `unlisten` 函式存入 `unlistenFunctions`
  - [x] 1.4 新增 `handleStartRecording()` action：
    - 防重複：若 `isRecording.value === true` 直接 return
    - `isRecording.value = true`
    - `recordingStartTime.value = performance.now()`
    - 呼叫 `initializeMicrophone()`（確保權限）
    - 呼叫 `startRecording()` from `lib/recorder.ts`（同步呼叫，不需 await）
    - `transitionTo('recording', '錄音中...')`
    - 發送 `voice-flow:state-changed` 事件 `{ status: 'recording' }`
  - [x] 1.5 新增 `handleStopRecording()` action：
    - 若 `isRecording.value === false` 直接 return
    - **不立即設 `isRecording = false`**（防止非同步期間重複觸發 race condition）
    - `transitionTo('transcribing', '轉錄中...')`
    - 呼叫 `stopRecording()` 取得 audio blob
    - 計算 `recordingDurationMs = performance.now() - recordingStartTime.value`
    - 從 `useSettingsStore().getApiKey()` 取得 API Key
    - 若 API Key 為空 → `isRecording.value = false` + `transitionTo('error', API_KEY_MISSING_ERROR)` + 發送 error 事件 + return
    - 呼叫 `transcribeAudio(audioBlob, apiKey)` from `lib/transcriber.ts`
    - 若 `!result.rawText`（無語音偵測）→ `isRecording.value = false` + `transitionTo('error', '未偵測到語音')` + return
    - `transitionTo('idle')` — 先轉 idle 讓 HUD 隱藏
    - `await invoke('paste_text', { text: result.rawText })` 貼上文字
    - `isRecording.value = false` — 整個流程完成才解鎖
    - `transitionTo('success', '已貼上 ✓')`
    - 發送 `voice-flow:state-changed` 事件 `{ status: 'success' }`
    - 整體包裹 try/catch：catch 時 `isRecording.value = false` + `transitionTo('error', humanReadableMessage)` + 發送 error 事件
    - **注意**：`isRecording` 在每個 exit path（success、error、early return）都必須設為 false
  - [x] 1.6 新增 `cleanup()` action：
    - 清除 `autoHideTimer`
    - 遍歷 `unlistenFunctions` 執行每個 `unlisten()`
    - 清空 `unlistenFunctions`
  - [x] 1.7 確保 store 匯出所有必要屬性：
    - 狀態：`status`, `message`（給 NotchHud 使用）
    - Actions：`initialize()`, `cleanup()`, `transitionTo()`
    - 不匯出內部狀態 `isRecording`, `recordingStartTime`, `autoHideTimer`

- [x] Task 2: 合併 TranscriptionResult 至 TranscriptionRecord，更新 transcriber.ts (AC: #2)
  - [x] 2.1 移除 `src/types/index.ts` 的 `TranscriptionResult` 介面（POC 遺留型別）
  - [x] 2.2 修改 `transcribeAudio()` 回傳型別為 `Pick<TranscriptionRecord, 'rawText' | 'transcriptionDurationMs'>`：
    - 原本回傳 `{ text, duration }` → 改為 `{ rawText, transcriptionDurationMs }`
    - import `TranscriptionRecord` from `types/transcription.ts`
  - [x] 2.3 更新所有使用 `TranscriptionResult` 的地方：
    - `result.text` → `result.rawText`
    - `result.duration` → `result.transcriptionDurationMs`
    - 涵蓋 `useVoiceFlowStore.ts`、`transcriber.test.ts` 等引用處
  - [x] 2.4 確認 `types/transcription.ts` 的 `TranscriptionRecord` 已包含所需欄位（`rawText`, `transcriptionDurationMs`）— 不需修改

- [x] Task 3: 更新 App.vue 使用 useVoiceFlowStore (AC: #6)
  - [x] 3.1 移除 `import { useVoiceFlow }` 和相關呼叫
  - [x] 3.2 新增 `import { useVoiceFlowStore }`
  - [x] 3.3 在 `setup` / `<script setup>` 中：
    - `const voiceFlowStore = useVoiceFlowStore()`
    - `onMounted` 中呼叫 `await voiceFlowStore.initialize()`
    - `onUnmounted` 中呼叫 `voiceFlowStore.cleanup()`
  - [x] 3.4 NotchHud props 改為從 store 讀取：
    - `:status="voiceFlowStore.status"` `:message="voiceFlowStore.message"`
  - [x] 3.5 啟動動畫邏輯保留在 App.vue 中（這是 HUD-only 的 UI 邏輯，不需移到 store）

- [x] Task 4: 清理舊 composables (AC: #6)
  - [x] 4.1 確認 `useVoiceFlow.ts` 的所有邏輯已被 store 完全取代
  - [x] 4.2 確認 `useHudState.ts` 的所有邏輯已被 store 完全取代
  - [x] 4.3 在 App.vue 和任何其他引用處移除 `useVoiceFlow` 和 `useHudState` 的 import
  - [x] 4.4 將 `useVoiceFlow.ts` 和 `useHudState.ts` 標記為可移除或刪除
    - 注意：若有測試檔案（`tests/unit/use-voice-flow.test.ts`）需要對應更新或移除
  - [x] 4.5 保留 `src/composables/useTauriEvents.ts`（跨視窗事件工具，非 HUD 專用）

- [x] Task 5: 跨視窗事件廣播 (AC: #1, #3, #5)
  - [x] 5.1 在 `handleStartRecording()` 和 `handleStopRecording()` 中，使用 `emit()` 發送 `VOICE_FLOW_STATE_CHANGED` 事件
    - **import 方式**：`import { emit } from "@tauri-apps/api/event"`（直接 import，不經過 composables）
    - **常數 import**：`import { VOICE_FLOW_STATE_CHANGED } from "@/composables/useTauriEvents"`（純值常數可接受）
  - [x] 5.2 事件 payload 型別：`VoiceFlowStateChangedPayload`（from `types/events.ts`），格式 `{ status: HudStatus, message: string }`
  - [x] 5.3 確保事件使用 `emit()` 全域廣播（非 `emitTo`），所有視窗都會收到

- [x] Task 6: 建立 useVoiceFlowStore 單元測試 (AC: #1-6)
  - [x] 6.1 建立 `tests/unit/use-voice-flow-store.test.ts`
  - [x] 6.2 Mock 所有外部依賴：recorder.ts、transcriber.ts、invoke、emit、listen、getCurrentWindow
  - [x] 6.3 測試 `initialize()`：事件監聽註冊、loadSettings 呼叫、initializeMicrophone 呼叫
  - [x] 6.4 測試 `handleStartRecording()`：正常流程、防重複觸發（isRecording guard）、麥克風失敗
  - [x] 6.5 測試 `handleStopRecording()`：正常流程（錄音→轉錄→貼上）、API Key 缺失、空轉錄結果、API 錯誤、race condition 防護
  - [x] 6.6 測試 `transitionTo()`：各狀態的 HUD 視窗管理（showHud/hideHud）、success/error auto-hide timer
  - [x] 6.7 測試 `cleanup()`：timer 清除、事件監聽解除
  - [x] 6.8 移除 `tests/unit/use-voice-flow.test.ts`（邏輯已遷移，舊測試不再適用）

- [ ] Task 7: 整合驗證 (AC: #1-6)
  - [x] 7.1 `cargo check` 通過
  - [x] 7.2 `vue-tsc --noEmit` 通過
  - [x] 7.3 更新 `tests/unit/transcriber.test.ts`（配合 TranscriptionResult → TranscriptionRecord 合併）
  - [ ] 7.4 手動測試：Hold 模式 — 按住觸發鍵 → 錄音 → 放開 → 轉錄 → 文字貼入游標位置
  - [ ] 7.5 手動測試：Toggle 模式 — 按一下開始 → 錄音 → 再按一下停止 → 轉錄 → 文字貼入游標位置
  - [ ] 7.6 手動測試：API Key 缺失時 → HUD 顯示錯誤訊息引導至設定頁面
  - [ ] 7.7 手動測試：網路斷線時 → HUD 顯示錯誤訊息，App 回到 idle
  - [ ] 7.8 手動測試：快速重複觸發 → 轉錄中按熱鍵無反應（race condition 防護）
  - [ ] 7.9 手動測試：HUD 狀態轉換流暢 — idle → recording → transcribing → success → idle（auto-hide）
  - [ ] 7.10 手動測試：HUD 錯誤狀態 — error → 2 秒後自動回 idle
  - [ ] 7.11 手動測試：無語音錄音 → HUD 顯示「未偵測到語音」錯誤

## Dev Notes

### 架構模式與約束

**Brownfield 專案** — 基於 Story 1.1（V2 基礎架構）、1.2（跨平台熱鍵系統）、1.3（API Key 儲存 + System Tray）繼續擴展。

**本 Story 的核心架構變更：** 將 composable-based 的狀態管理（useVoiceFlow + useHudState）遷移至 Pinia store-based 架構（useVoiceFlowStore），符合 V2 架構文件的決策。

**依賴方向規則（嚴格遵守）：**
```
views/ → components/ + stores/ + composables/
stores/ → lib/
lib/ → 外部 API（Groq）
composables/ → stores/ + lib/
```

**禁止：**
- ❌ views/ 直接呼叫 lib/（必須透過 store）
- ❌ API Key 存入 SQLite（只用 tauri-plugin-store）
- ❌ 在元件中直接執行 SQL
- ❌ Store 中引入 Vue lifecycle hooks（onMounted 等）

### 遷移策略：useVoiceFlow + useHudState → useVoiceFlowStore

**為什麼遷移：**
- 架構文件指定狀態管理使用 Pinia stores
- useVoiceFlowStore 已存在但只有骨架（19 行），useVoiceFlow composable 持有所有實際邏輯
- 雙重狀態管理（composable + store）導致架構不一致
- Store 更易測試，且支援跨視窗狀態共享（透過 Tauri Events）

**遷移前後對比：**

```
遷移前：
App.vue → useVoiceFlow() → useHudState()
                         → recorder.ts
                         → transcriber.ts
                         → invoke('paste_text')

遷移後：
App.vue → useVoiceFlowStore
              ├─ 狀態管理（status, message, isRecording）
              ├─ HUD 視窗控制（showHud/hideHud + auto-hide）
              ├─ 事件監聽（hotkey events）
              ├─ 錄音流程（recorder.ts）
              ├─ 轉錄流程（transcriber.ts）
              └─ 貼上流程（invoke paste_text）
```

**useHudState.ts 邏輯去向：**
- `showHud()` → 移入 store：`getCurrentWindow().show()` + `setIgnoreCursorEvents(true)`（讓滑鼠穿透 HUD，**不用 setFocus**）
- `hideHud()` → 移入 store：`getCurrentWindow().hide()`
- `transitionTo()` + auto-hide timer → 合併入 store 的 `transitionTo()`
- `state` ref → 使用 store 的 `status` + `message`
- `cleanup()` timer → 移入 store 的 `cleanup()`

**useVoiceFlow.ts 邏輯去向：**
- `initialize()` → store 的 `initialize()` action
- 事件監聽（HOTKEY_PRESSED/RELEASED/TOGGLED/ERROR）→ store `initialize()` 內註冊
- `handleStartRecording()` → store action
- `handleStopRecording()` → store action
- `isRecording` ref → store 內部 ref
- `state` ref → 已由 store 的 `status`/`message` 取代

### 現有 useVoiceFlowStore 程式碼（需擴展）

```typescript
// 現有骨架（19 行）
export const useVoiceFlowStore = defineStore("voice-flow", () => {
  const status = ref<HudStatus>("idle");
  const message = ref("");

  function transitionTo(newStatus: HudStatus, newMessage?: string) {
    status.value = newStatus;
    message.value = newMessage ?? "";
  }

  return { status, message, transitionTo };
});
```

需要擴展為：完整的錄音→轉錄→貼上流程引擎 + HUD 視窗管理。

### 現有 useVoiceFlow.ts 關鍵流程（需遷移）

**事件監聽初始化（lines 37-91）：**
```typescript
// HOTKEY_PRESSED → handleStartRecording()
// HOTKEY_RELEASED → handleStopRecording()
// HOTKEY_TOGGLED → 根據 action start/stop
// HOTKEY_ERROR → transitionTo("error", message)
```

**錄音開始（handleStartRecording, lines 100-115）：**
```typescript
async function handleStartRecording() {
  if (isRecording.value) return;  // 防重複
  isRecording.value = true;
  try {
    await initializeMicrophone();
    transitionTo("recording", "Recording...");
    await startRecording();
  } catch (err) {
    isRecording.value = false;
    transitionTo("error", "麥克風初始化失敗");
  }
}
```

**錄音停止 + 轉錄 + 貼上（handleStopRecording, lines 117-159）：**
```typescript
// ⚠️ 現有程式碼有 race condition：isRecording 在非同步操作前就清除
// Store 版本修正：isRecording 在每個 exit path 才設為 false
async function handleStopRecording() {
  if (!isRecording.value) return;
  // ❌ 現有：isRecording = false（太早）
  // ✅ Store 版：不在此處設 false，移至每個 exit path
  transitionTo("transcribing", "Transcribing...");
  try {
    const audioBlob = await stopRecording();
    const currentApiKey = settingsStore.getApiKey();
    if (!currentApiKey) { isRecording.value = false; /* error + return */ }
    const result = await transcribeAudio(audioBlob, currentApiKey);
    if (!result.rawText) { isRecording.value = false; /* "未偵測到語音" + return */ }
    transitionTo("idle");  // 先隱藏 HUD
    await invoke("paste_text", { text: result.rawText });
    isRecording.value = false;  // ✅ 流程完成才解鎖
    transitionTo("success", `已貼上 ✓`);
  } catch (err) {
    isRecording.value = false;  // ✅ 錯誤時也解鎖
    transitionTo("error", humanReadableMessage);
  }
}
```

**重要時序：** `transitionTo("idle")` → 隱藏 HUD → 目標應用獲得焦點 → `paste_text` 貼上。如果不先隱藏 HUD，`paste_text` 的 `window.hide()` 會觸發（見 clipboard_paste.rs line 54-58），但順序可能不正確。

**Race condition 修正：** `isRecording` 作為整個非同步流程的鎖，只在流程完成（success/error/early return）時才釋放。這防止使用者在轉錄期間再次觸發錄音。

### 現有 useHudState.ts 關鍵邏輯（需遷移）

```typescript
// 視窗管理
async function showHud() {
  await appWindow.show();
  await appWindow.setIgnoreCursorEvents(true); // 滑鼠穿透，不搶焦點
}
async function hideHud() {
  await appWindow.hide();
}

// 狀態轉換 + auto-hide
function transitionTo(status: HudStatus, message = "") {
  if (autoHideTimer) clearTimeout(autoHideTimer);
  state.value = { status, message };

  switch (status) {
    case "idle": hideHud(); break;
    case "recording":
    case "transcribing": showHud(); break;
    case "success":
      showHud();
      autoHideTimer = setTimeout(() => transitionTo("idle"), 1000);
      break;
    case "error":
      showHud();
      autoHideTimer = setTimeout(() => transitionTo("idle"), 2000);
      break;
  }
}
```

**注意：** `showHud()` 使用 `getCurrentWindow().show()` + `setIgnoreCursorEvents(true)`（不用 `setFocus()`，避免搶走目標應用焦點）。`hideHud()` 使用 `getCurrentWindow().hide()`。在 store 中同樣可以使用此 API，因為 store 在 HUD Window 的 Vue App 實例中初始化。

### transcriber.ts 改造重點

**現有回傳型別（POC 遺留，需合併至 V2 型別）：**
```typescript
// ❌ 移除 — src/types/index.ts 的 POC 型別
interface TranscriptionResult {
  text: string;      // 轉錄文字
  duration: number;  // 轉錄 API 耗時（毫秒）— 名稱模糊
}
```

**改為使用 V2 型別（已存在於 src/types/transcription.ts）：**
```typescript
// ✅ 使用 TranscriptionRecord 的 Pick 子集
import type { TranscriptionRecord } from "@/types/transcription";
type TranscriberResult = Pick<TranscriptionRecord, "rawText" | "transcriptionDurationMs">;

// transcribeAudio() 回傳：
return { rawText: data.text, transcriptionDurationMs };
```

**影響範圍：**
- `result.text` → `result.rawText`（所有引用處）
- `result.duration` → `result.transcriptionDurationMs`（所有引用處）
- 移除 `TranscriptionResult` 從 `types/index.ts`

**注意：** `recordingDurationMs` 由 store 在 `handleStopRecording()` 中計算（`performance.now() - recordingStartTime`），不由 transcriber.ts 負責。transcriber.ts 只負責回報轉錄 API 呼叫耗時。

### clipboard_paste.rs 呼叫格式

**Tauri Command 簽名（不修改）：**
```rust
#[tauri::command]
pub fn paste_text<R: Runtime>(app: AppHandle<R>, text: String) -> Result<(), ClipboardError>
```

**前端呼叫：**
```typescript
await invoke("paste_text", { text: transcriptionText });
```

**內部流程（已實作，不需修改）：**
1. 隱藏 Tauri HUD 視窗
2. 等待 200ms 讓 OS 切換焦點到目標應用
3. 寫入文字到系統剪貼簿（arboard）
4. 驗證剪貼簿內容
5. 等待 50ms
6. macOS：模擬 Cmd+V（CGEvent）
7. Windows：模擬 Ctrl+V

**重要時序問題：** `paste_text` 內部已經會隱藏 HUD 視窗。但 store 的 `transitionTo('idle')` 也會呼叫 `hideHud()`。建議的處理方式：在呼叫 `paste_text` 前先 `transitionTo('idle')`（觸發 hideHud），然後 `paste_text` 內部的 hide 會是 no-op（視窗已隱藏）。這是現有 `useVoiceFlow.ts` 的做法（line 149: `transitionTo("idle")` → line 151: `invoke("paste_text")`）。

### Tauri Events 跨視窗通訊

**事件常數（定義在 composables/useTauriEvents.ts，個別匯出）：**
```typescript
// 個別常數匯出（非物件）
export const VOICE_FLOW_STATE_CHANGED = "voice-flow:state-changed" as const;
export const TRANSCRIPTION_COMPLETED = "transcription:completed" as const;
export const HOTKEY_PRESSED = "hotkey:pressed" as const;
export const HOTKEY_RELEASED = "hotkey:released" as const;
export const HOTKEY_TOGGLED = "hotkey:toggled" as const;
export const HOTKEY_ERROR = "hotkey:error" as const;

// 函式別名匯出
export { emit as emitEvent } from "@tauri-apps/api/event";
export { listen as listenToEvent } from "@tauri-apps/api/event";
```

**⚠️ Store 中的 import 策略（避免依賴方向違規）：**
```typescript
// ❌ 不要從 composables import（違反 stores/ → lib/ 規則）
// import { emitEvent } from "@/composables/useTauriEvents";

// ✅ Store 直接 import Tauri API + 事件常數
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  HOTKEY_PRESSED, HOTKEY_RELEASED, HOTKEY_TOGGLED, HOTKEY_ERROR,
  VOICE_FLOW_STATE_CHANGED,
} from "@/composables/useTauriEvents"; // 常數是純值，不算依賴違規
```

**注意：** 常數 import 是純值參考，不引入 Vue 響應式依賴，因此從 composables import 常數可接受。但函式（`emitEvent`/`listenToEvent`）應直接從 `@tauri-apps/api/event` import，因為它們只是 re-export。

**事件發送範例：**
```typescript
// 在 store 中發送事件（使用直接 import 的 emit）
await emit(VOICE_FLOW_STATE_CHANGED, {
  status: "recording",
  message: "錄音中...",
});
```

**注意：** `emit` 是全域廣播，所有視窗都會收到。HUD Window 的 store 發送事件，Main Window 的相關 store 可以訂閱並更新。但 Story 1.4 的 Main Window 不需要做任何反應（Dashboard 更新是 Story 4.1 的範圍）。

### TypeScript 事件型別（types/events.ts）

**Store 必須使用的型別（已定義在 `src/types/events.ts`）：**
```typescript
import type { HotkeyEventPayload, HotkeyErrorPayload, VoiceFlowStateChangedPayload } from "@/types/events";

// 熱鍵事件 payload
interface HotkeyEventPayload {
  mode: TriggerMode;      // "hold" | "toggle"
  action: "start" | "stop";
}

// 熱鍵錯誤 payload
interface HotkeyErrorPayload {
  error: string;    // 錯誤碼
  message: string;  // 人類可讀訊息
}

// 語音流程狀態變更 payload
interface VoiceFlowStateChangedPayload {
  status: HudStatus;
  message: string;
}
```

**使用場景：**
- `listen<HotkeyEventPayload>(HOTKEY_PRESSED, ...)` — type-safe 事件監聽
- `listen<HotkeyErrorPayload>(HOTKEY_ERROR, ...)` — 錯誤事件
- `emit(VOICE_FLOW_STATE_CHANGED, payload as VoiceFlowStateChangedPayload)` — 狀態廣播

### debug_log 除錯模式

**現有模式（從 useVoiceFlow.ts 遷移）：**
```typescript
import { invoke } from "@tauri-apps/api/core";

function log(message: string) {
  invoke("debug_log", { level: "info", message });
}

function logError(message: string) {
  invoke("debug_log", { level: "error", message });
}
```

**Store 中應保留此模式**，在關鍵節點記錄日誌：initialize、recording start/stop、transcription、paste、errors。Rust 端 `debug_log` command 已存在，不需修改。

### hotkey_listener.rs 事件 payload 格式

**Rust 端發送的事件 payload：**
```rust
// Hold 模式
HotkeyEventPayload { mode: TriggerMode::Hold, action: HotkeyAction::Start }
// Serde 序列化為 JSON：{ "mode": "hold", "action": "start" }

HotkeyEventPayload { mode: TriggerMode::Hold, action: HotkeyAction::Stop }
// JSON：{ "mode": "hold", "action": "stop" }

// Toggle 模式
HotkeyEventPayload { mode: TriggerMode::Toggle, action: HotkeyAction::Start }
// JSON：{ "mode": "toggle", "action": "start" }
```

**前端接收（使用 types/events.ts 型別）：**
```typescript
import type { HotkeyEventPayload, HotkeyErrorPayload } from "@/types/events";

listen<HotkeyEventPayload>(HOTKEY_PRESSED, () => {
  // Hold 模式按下 → 開始錄音
  handleStartRecording();
});

listen<HotkeyEventPayload>(HOTKEY_RELEASED, () => {
  // Hold 模式放開 → 停止錄音
  handleStopRecording();
});

listen<HotkeyEventPayload>(HOTKEY_TOGGLED, (event) => {
  // Toggle 模式切換
  if (event.payload.action === "start") handleStartRecording();
  if (event.payload.action === "stop") handleStopRecording();
});

listen<HotkeyErrorPayload>(HOTKEY_ERROR, (event) => {
  logError(`hotkey error: ${event.payload.message}`);
  transitionTo("error", "請授予輔助使用權限");
});
```

### recorder.ts 使用要點

**現有 API（不需修改）：**
```typescript
import { initializeMicrophone, startRecording, stopRecording } from "@/lib/recorder";

await initializeMicrophone();   // 請求麥克風權限，16kHz 取樣率
startRecording();               // 同步呼叫：建立 MediaRecorder 並開始收集 audio chunks（不需 await）
const blob = await stopRecording(); // 停止錄音，回傳合併的 audio Blob
```

**recorder.ts 不追蹤錄音時間。** 錄音時長由 store 用 `performance.now()` 差值計算：
```typescript
recordingStartTime.value = performance.now(); // startRecording 前
// ... 錄音中 ...
const recordingDurationMs = performance.now() - recordingStartTime.value; // stopRecording 後
```

### 測試檔案影響

**受影響的測試：**
- `tests/unit/use-voice-flow.test.ts` — 移除（邏輯遷移至 store，由新測試取代）
- `tests/unit/use-voice-flow-store.test.ts` — 新建（Task 6，測試 store 的完整流程）
- `tests/unit/transcriber.test.ts` — 更新（`text` → `rawText`，`duration` → `transcriptionDurationMs`，移除 `TranscriptionResult` 參考）

**Story 1.3 的測試結果：** 6 files / 77 tests 全部通過。本 Story 的改動可能 break 部分測試。

### 跨 Story 注意事項

- **Story 2.1** 會建立 `enhancer.ts` 並在 voiceFlow 中新增 `'enhancing'` 狀態。本 Story 的 useVoiceFlowStore 設計需要預留 `'enhancing'` 狀態的擴展空間（HudStatus union type 已包含 `'enhancing'`）
- **Story 4.1** 會在 `handleStopRecording()` 後新增歷史記錄寫入。本 Story 的 store 結構需要方便後續擴展（在 success 之後加入 `useHistoryStore.addTranscription()` 呼叫）
- **Story 1.5** 會擴展 NotchHud.vue 為完整 6 態顯示。本 Story 只處理 4 態（idle/recording/transcribing/success/error），enhancing 由 Story 2.1 加入

### 前一個 Story (1.3) 關鍵學習

- `cargo check` 有既存 warnings（objc macro cfg, dead_code）— 不影響功能，不需處理
- `vue-tsc --noEmit` 在 Story 1.3 修復了 `transcriber.ts:17` 的 `import.meta.env` 型別錯誤
- tauri-plugin-updater 已從 lib.rs 移除（commit ae44200）— 不要重新加入
- `getApiKey()` getter 已在 Story 1.3 建立，本 Story 直接使用
- 前端 TriggerKey 使用 union type 保持與 Rust serde 一致
- 錯誤處理模式：`err instanceof Error ? err.message : String(err)` 已確立為標準
- `useSettingsStore` 的 `loadSettings()` 在 `main-window.ts` 的 `bootstrap()` 中呼叫，在 HUD Window 的 `main.ts` 中也需要確認是否呼叫（檢查 `App.vue` 的 `initialize()` 流程）

### Git 歷史分析

**最近 commit 模式：**
- `feat:` 前綴用於功能實作（Story 1.1, 1.2, 1.3）
- `fix:` 前綴用於 code review 後修復
- `docs:` 前綴用於 BMAD artifacts 更新
- `refactor:` 前綴用於重新命名/重構

**最近改動的關鍵檔案（與本 Story 直接相關）：**
- `src/stores/useVoiceFlowStore.ts` — Story 1.1 建立骨架（19 行），未被任何元件使用
- `src/composables/useVoiceFlow.ts` — Story 1.2/1.3 修改了事件監聽 + API Key 取用
- `src/composables/useHudState.ts` — Story 1.1 以來未變動
- `src/App.vue` — Story 1.1 建立 HUD 入口，使用 useVoiceFlow
- `src/lib/transcriber.ts` — Story 1.3 移除 env var，改為 apiKey 參數注入
- `src/lib/recorder.ts` — POC 以來未變動

### 技術版本確認（2026-03-02）

| 技術 | 版本 | 備註 |
|------|------|------|
| Groq Whisper API | whisper-large-v3 | model 參數，language: "zh" |
| Tauri | v2.10.x | `invoke()`, `emit()`, `getCurrentWindow()` |
| Pinia | 3.x | `defineStore("voice-flow", () => { ... })` |
| Vue Router | 5.0.3 | hash mode |
| MediaRecorder API | Web Standard | 16kHz, 降噪 |
| arboard (Rust) | 3.6.1 | 跨平台剪貼簿 |

### 不需要的 Cargo/NPM 依賴變更

本 Story **不需要安裝任何新依賴**。所有需要的技術已在 Story 1.1-1.3 安裝完畢。

### 現有檔案改動點

**修改檔案：**
```
src/stores/useVoiceFlowStore.ts    — 從骨架擴展為完整流程引擎（核心工作）
src/App.vue                         — 改用 useVoiceFlowStore 替代 useVoiceFlow
src/types/index.ts                  — 移除 TranscriptionResult 介面（合併至 TranscriptionRecord）
src/lib/transcriber.ts              — 回傳型別改用 Pick<TranscriptionRecord>，text → rawText
tests/unit/transcriber.test.ts      — 配合 TranscriptionRecord 合併更新
```

**新增檔案：**
```
tests/unit/use-voice-flow-store.test.ts — useVoiceFlowStore 完整單元測試
```

**移除檔案（遷移完成後）：**
```
src/composables/useVoiceFlow.ts     — 邏輯完全遷移至 store
src/composables/useHudState.ts      — 邏輯完全遷移至 store
```

**不修改的檔案（明確排除）：**
- `src/lib/recorder.ts` — 錄音 API 不變
- `src-tauri/src/plugins/clipboard_paste.rs` — 貼上邏輯不變
- `src-tauri/src/plugins/hotkey_listener.rs` — 熱鍵邏輯不變
- `src-tauri/src/lib.rs` — Tray/視窗配置不變
- `src/composables/useTauriEvents.ts` — 事件工具不變
- `src/views/SettingsView.vue` — 設定 UI 不變
- `src/components/NotchHud.vue` — 接收 props 不變，只是資料來源從 composable 改為 store
- `src/main-window.ts` — Main Window 啟動邏輯不變
- `Cargo.toml` / `package.json` — 不需新增依賴
- `capabilities/default.json` — 權限不變

### 安全規則提醒

- API Key 從 `useSettingsStore().getApiKey()` 取得，不硬編碼
- API Key 不寫入任何日誌（`console.log` 不印 Key 值）
- API Key 不透過 Tauri Event 傳播
- CSP `connect-src 'self' https://api.groq.com` 限制 API Key 只能傳到 Groq

### 效能注意事項

- **E2E 目標（不含 AI 整理）** — < 1.5 秒（從放開按鍵到文字出現在游標位置）
- **HUD 狀態轉換** — < 100ms（Tauri Events 驅動，非輪詢）
- **剪貼簿操作延遲** — paste_text 內部有 200ms + 50ms 等待（總計 250ms）
- **錄音編碼** — MediaRecorder 自動處理，16kHz 取樣率
- **API 呼叫** — 非同步，不阻塞 UI

### Project Structure Notes

- 本 Story 改動符合統一專案結構：store 層處理狀態管理和業務流程
- useVoiceFlowStore 成為 HUD Window 的核心狀態引擎
- 依賴方向維持單向：App.vue → store → lib services
- store 不引入 Vue lifecycle hooks（onMounted 等），使用 `initialize()`/`cleanup()` 模式

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 1 — Story 1.4]
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture — Pinia Stores 結構]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns — Communication Patterns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries — Component Boundaries]
- [Source: _bmad-output/planning-artifacts/architecture.md#Integration Points — 核心語音流程]
- [Source: _bmad-output/planning-artifacts/prd.md#語音觸發與錄音 FR1-FR6, FR13-FR14, FR26-FR28]
- [Source: _bmad-output/implementation-artifacts/1-3-api-key-storage-system-tray.md — 跨 Story 注意事項, Dev Notes]
- [Source: _bmad-output/project-context.md — Critical Implementation Rules, Framework-Specific Rules]
- [Source: Codebase — src/composables/useVoiceFlow.ts（遷移來源）]
- [Source: Codebase — src/composables/useHudState.ts（遷移來源）]
- [Source: Codebase — src/stores/useVoiceFlowStore.ts（擴展目標）]
- [Source: Codebase — src/lib/recorder.ts（錄音服務）]
- [Source: Codebase — src/lib/transcriber.ts（轉錄服務）]
- [Source: Codebase — src-tauri/src/plugins/clipboard_paste.rs（貼上服務）]
- [Source: Codebase — src-tauri/src/plugins/hotkey_listener.rs（事件格式）]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex (Codex CLI)

### Debug Log References

- `2026-03-02` `pnpm test`：5/5 測試檔、48/48 測試案例通過
- `2026-03-02` `pnpm exec vue-tsc --noEmit`：通過（0 errors）
- `2026-03-02` `cargo check`（`src-tauri`）：通過（0 errors, 0 warnings）
- `2026-03-02` Code Review 後 `pnpm test`：5/5 測試檔、50/50 測試案例通過（+2 新測試）
- `2026-03-02` Code Review 後 `pnpm exec vue-tsc --noEmit`：通過（0 errors）

### Completion Notes List

- 已將 `useVoiceFlowStore` 擴展為完整錄音→轉錄→貼上流程，整合 HUD 顯示/隱藏與 auto-hide timer。
- 已把 `App.vue` 改為使用 `useVoiceFlowStore`，並在元件卸載時執行 `cleanup()`。
- 已完成 `TranscriptionResult` → `TranscriptionRecord` 子型別遷移，更新 `transcriber.ts` 與相關測試。
- 已移除舊 composables（`useVoiceFlow.ts`, `useHudState.ts`）與舊單元測試，新增 `use-voice-flow-store` 測試覆蓋核心流程。
- 因終端機環境限制，Task 7 的手動驗證項目（7.4-7.11）尚未執行，故事維持 `in-progress`。
- `2026-03-02` Code Review (Claude Opus 4.6) 修復 6 項 issues：
  - [H1] `handleStopRecording` 貼上前改為 `transitionTo("idle")` 符合 spec
  - [M1] `getCurrentWindow()` 改為 lazy 初始化（`getAppWindow()`）
  - [M2] 補 `HOTKEY_ERROR` 事件處理單元測試
  - [M3] `types.test.ts` HudStatus 測試補上 `enhancing`
  - [M4] `showHud/hideHud` 錯誤改為 `.catch(writeErrorLog)` 不再靜默吞掉
  - [L4] 補 auto-hide timer emit idle 事件測試

### File List

- `src/stores/useVoiceFlowStore.ts` (modified)
- `src/App.vue` (modified)
- `src/lib/transcriber.ts` (modified)
- `src/types/index.ts` (modified)
- `tests/unit/use-voice-flow-store.test.ts` (added)
- `tests/unit/transcriber.test.ts` (modified)
- `tests/unit/types.test.ts` (modified)
- `src/composables/useVoiceFlow.ts` (deleted)
- `src/composables/useHudState.ts` (deleted)
- `tests/unit/use-voice-flow.test.ts` (deleted)
- `tests/unit/use-hud-state.test.ts` (deleted)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
- `_bmad-output/implementation-artifacts/1-4-voice-record-transcribe-paste.md` (modified)

### Change Log

- `2026-03-02`：完成 Task 1-6 與 Task 7.1-7.3；保留 Task 7.4-7.11 手動驗證待執行。
- `2026-03-02`：Code Review (Claude Opus 4.6) — 修復 1 HIGH / 4 MEDIUM / 1 LOW issues，測試 48→50。

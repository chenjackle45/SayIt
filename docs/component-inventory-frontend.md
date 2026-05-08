# Component Inventory — Frontend

> Vue 3 components · 自製元件 + shadcn-vue（new-york style）UI 庫
> 掃描日期：2026-05-08 · root: `src/components/`

---

## 一、自製元件（11 個 · ~1.9 KLOC）

### 1.1 HUD 主元件

#### `NotchHud.vue`（861 LOC）
- **位置**：HUD 視窗主畫面
- **職責**：根據 `useVoiceFlowStore.hudState.status` 切換 8 種 UI（idle / recording / transcribing / enhancing / editing / success / error / cancelled）；訂閱 `audio:waveform` 顯示波形動畫；訂閱 `vocabulary:learned` 顯示「字典學習到」提示
- **依賴**：useVoiceFlowStore、useAudioWaveform composable

### 1.2 Dashboard 結構性元件

| 元件                      | LOC | 職責                                                                          |
| ------------------------- | --: | ----------------------------------------------------------------------------- |
| `AppSidebar.vue`          | 177 | Dashboard 側邊欄總成（用 shadcn-vue `SidebarProvider` + `Sidebar` + `SidebarMenu`） |
| `NavMain.vue`             |  57 | 側邊欄主導航（Dashboard / History / Dictionary / Settings）                   |
| `NavSecondary.vue`        |  41 | 側邊欄次要導航（Feature Guide）                                               |
| `NavDocuments.vue`        |  91 | 側邊欄文件區（外部連結）                                                      |
| `NavUser.vue`             | 114 | 側邊欄底部使用者區塊 + 登出                                                   |
| `SiteHeader.vue`          |  15 | Dashboard 頂部                                                                |

### 1.3 Dashboard 內容元件

| 元件                          | LOC | 用於                              |
| ----------------------------- | --: | --------------------------------- |
| `SectionCards.vue`            | 106 | DashboardView 統計卡片             |
| `DashboardUsageChart.vue`     |  89 | DashboardView unovis 使用量圖表    |

### 1.4 引導 / 教學元件

| 元件                      | LOC | 用於                                                  |
| ------------------------- | --: | ----------------------------------------------------- |
| `AccessibilityGuide.vue`  | 191 | macOS 輔助使用權限引導（必要權限說明 + 開啟系統設定按鈕） |

---

## 二、shadcn-vue UI 元件（21 個 · `src/components/ui/`）

> **強制使用，禁止手寫替代品**。詳見 `architecture-frontend.md` §10。

| 類別            | 元件                                                  | 用途                                            |
| --------------- | ----------------------------------------------------- | ----------------------------------------------- |
| Layout / Container | `card`、`separator`、`sheet`、`tabs`               | 區塊、分隔線、抽屜、頁籤                        |
| Form / Input    | `input`、`textarea`、`select`、`switch`、`checkbox`、`radio-group`、`label` | 表單元件                  |
| Navigation      | `sidebar`、`dropdown-menu`                            | 側邊欄、下拉選單                                |
| Feedback        | `alert-dialog`、`tooltip`                             | 對話框、Tooltip                                 |
| Display         | `avatar`、`badge`、`skeleton`、`table`                | 頭像、標籤、骨架屏、表格                        |
| Action          | `button`                                              | 按鈕                                            |
| Chart           | `chart`                                               | 圖表（依賴 unovis）                             |

### 元件 API 規範（必須遵守）

| 規則                          | 範例                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| **variant 優先**              | `<Button variant="destructive">` 而非 `<Button class="bg-red-500 text-white">`       |
| **Switch 綁定**               | `:model-value="..."` + `@update:model-value="..."` （**不是** `:checked`）           |
| **Select 綁定**               | `:model-value="..."` + `@update:model-value="..."`                                    |
| **Label 無障礙**              | `<Label for="api-key">` 對應 `<Input id="api-key">`                                  |
| **Badge variant**             | 用 `variant="secondary"` 等 prop，不用 class 覆蓋整套樣式                            |
| **RadioGroup 綁定**           | `:model-value` + `@update:model-value`，payload 為 `AcceptableValue`（需 runtime narrowing） |
| **RouterLink 在 Menu 中**     | `<SidebarMenuButton as-child><RouterLink>...</RouterLink></SidebarMenuButton>`       |

---

## 三、樣式系統

### 3.1 必用語意色彩（Tailwind 4 + shadcn-vue 變數）

```
✅ bg-primary / text-primary / border-primary
✅ bg-card / text-card-foreground / border-border
✅ bg-muted / text-muted-foreground
✅ bg-accent / text-accent-foreground
✅ bg-destructive / text-destructive

❌ bg-zinc-900 / text-white / border-zinc-700
❌ bg-blue-500 / hover:bg-blue-600
```

### 3.2 元件樣式覆蓋準則

可微調：padding、size、間距、特定 emoji-only 變化
不可動：核心色彩、shadcn-vue 元件內部結構、variant 樣式表

### 3.3 圖示

**唯一允許**：`lucide-vue-next`

```vue
import { Mic, Settings, Trash2 } from 'lucide-vue-next';
<Mic class="size-4" />
```

**禁止**：`@tabler/icons-vue`（雖已安裝，但僅為 dashboard-01 block 附帶）

---

## 四、Composable 對應元件

| Composable                | 主要使用方                       | 用途                                         |
| ------------------------- | -------------------------------- | -------------------------------------------- |
| `useTauriEvents.ts`       | 全部（唯一 event API import）   | event constant + listen/emit re-export       |
| `useAudioWaveform.ts`     | `NotchHud.vue`                   | 訂閱 `audio:waveform` 驅動波形 SVG            |
| `useAudioPreview.ts`      | `SettingsView.vue`               | 訂閱 `audio:preview-level` 驅動音量條         |
| `useFeedbackMessage.ts`   | `MainApp.vue` / 各 view          | 短暫提示訊息（自動更新成功 / 失敗 / 進行中等） |

---

## 五、views 與 components 的對應

```
DashboardView.vue
  ├─ SectionCards
  └─ DashboardUsageChart

HistoryView.vue
  └─ shadcn-vue: Table、Input、Button、DropdownMenu、Tooltip

DictionaryView.vue
  └─ shadcn-vue: Table、Input、Button、AlertDialog

SettingsView.vue（1907 LOC，最大 view）
  ├─ AccessibilityGuide
  └─ shadcn-vue: 全部表單元件 + Tabs + Sheet

FeatureGuideView.vue
  └─ shadcn-vue: Card

MainApp.vue（Dashboard root）
  ├─ AppSidebar
  │   ├─ NavMain
  │   ├─ NavDocuments
  │   ├─ NavSecondary
  │   └─ NavUser
  └─ SiteHeader

App.vue（HUD root）
  └─ NotchHud
```

---

## 六、設計流程強制（不可跳過）

> **❌ 未經設計直接實作 UI** → ✅ **先用 Pencil MCP 完成 `design.pen` 設計稿**

新 UI 功能必須走：
1. 在 `design.pen` 完成視覺設計（Pencil MCP `batch_design`）
2. 跟使用者對齊設計稿
3. 才開始實作 Vue 元件
4. 實作後對照設計稿微調

> 詳見 `_bmad-output/planning-artifacts/ux-ui-design-spec.md`。

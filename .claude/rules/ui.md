---
paths:
  - src/views/**
  - src/components/**
  - src/App.vue
  - src/MainApp.vue
  - design.pen
---

# UI 規則（shadcn-vue、設計稿先行）

> 2026-09-11 自 `CLAUDE.md` 搬入，內容未改；末段「拍板 demo」為新增。完整 UX 規範見 `_bmad-output/planning-artifacts/ux-ui-design-spec.md`。

## 設計稿先行

- **❌ 未經設計直接實作 UI** → 先用 Pencil MCP 在 `design.pen` 完成設計稿並取得使用者確認，再寫程式碼
- **拍板 demo 視為規格的一部分**：決策頁上拍過板的畫面（HTML demo），複製一份進 `docs/demos/<主題>/`，計畫檔直接引用該路徑；文字描述與 demo 衝突時以 demo 為準。UI 類改動驗收要做「demo vs 實畫面」對照，不只對文字

## shadcn-vue 元件使用規則

### 禁止手寫替代品

| 需求 | ❌ 禁止 | ✅ 必須使用 |
|------|--------|-----------|
| 側邊欄 | 手寫 `<nav>` | `SidebarProvider` + `Sidebar` + `SidebarMenu` 等 |
| 側邊欄切換 | 自訂 emit + ref | `SidebarTrigger`（內建 `toggleSidebar()`） |
| 可點擊元素 | 原生 `<button>` + 手寫樣式 | `<Button>` + variant prop |
| 表單輸入 | 原生 `<input>` / `<select>` / `<textarea>` | `Input` / `Select` / `Textarea` |
| 表格 | 原生 `<table>` | `Table` + `TableHeader` + `TableBody` 等 |
| 開關 | 原生 checkbox | `Switch` |
| 選項組 | 原生 `<input type="radio">` | `RadioGroup` + `RadioGroupItem` |

### 元件 API 規範

- **variant 優先**：用 `variant="destructive"` 而非 `class="text-destructive border-destructive"`
- **Switch 綁定**：`:model-value` + `@update:model-value`（不是 `:checked`）
- **Select 綁定**：`:model-value` + `@update:model-value`
- **Label 無障礙**：Label 必須加 `for` 屬性，對應控制項加 `id`
- **Badge variant**：用 `variant="secondary"` 等 prop，不用 class 覆蓋整套樣式
- **RadioGroup 綁定**：`:model-value` + `@update:model-value`，payload 型別為 `AcceptableValue`（需 runtime narrowing）
- **RouterLink 在 Menu 中**：`<SidebarMenuButton as-child>` 包裹 `<RouterLink>`

### 樣式規則

- 語意色彩優先：`bg-card` / `text-foreground` / `border-border`
- 禁止硬編碼：`bg-zinc-900` / `text-white` / `border-zinc-700`
- 覆蓋元件樣式時只微調（如 padding、size），不覆蓋核心色彩
- 圖示只用 `lucide-vue-next`，不用 `@tabler/icons-vue`

## 依賴方向

- `views/` 只能 import `components/`、`stores/`、`composables/`；**❌ views 直接呼叫 lib** → 必須透過 Pinia store
- 元件不可直接執行 SQL

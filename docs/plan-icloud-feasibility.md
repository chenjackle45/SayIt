# 前置①：Mac 版（Developer ID）取得 iCloud 權限的可行性

> 建立：2026-11-28 · 狀態：書面查證完成（有條件可行），實機實驗待使用者在 Apple Developer 網站操作
> 範圍：只回答「能不能、怎麼做」。真正的同步實作是前置②（另一張卡）。

## 結論
三項功能都能用：iCloud 鑰匙圈同步、iCloud 鍵值儲存、CloudKit 私人資料庫。條件是建立 **Developer ID provisioning profile**，打包時內嵌到 `Contents/embedded.provisionprofile`。

| 項目 | 判斷 | 依據 |
|---|---|---|
| CloudKit、鍵值儲存、鑰匙圈共享 | Developer ID 可用（查證） | Apple 支援表 https://developer.apple.com/help/account/reference/supported-capabilities-macos ；https://developer.apple.com/support/developer-id/ |
| 鑰匙圈同步 | 走資料保護鑰匙圈、需 profile 授權、存取群組以 Team ID 開頭（查證） | Apple 工程師論壇回覆 thread/696431、826107 |
| Tauri 內嵌 profile | `bundle.macOS.files` 放 `embedded.provisionprofile`、`bundle.macOS.entitlements` 指定權限檔（查證） | https://v2.tauri.app/distribute/macos-application-bundle/ |
| CI（tauri-action） | 不需額外支援；profile 不含私鑰，可進 repo 或存成 secret（推論） | 同上 |
| 開發模式 | `pnpm tauri dev` 未簽章，iCloud 都不能用，只能用簽章版測（推論） | — |

## 風險
- **profile 過期，App 就無法啟動**：Gatekeeper 每次啟動都會檢查 profile。Developer ID profile 的有效期是 18 年，與憑證到期無關（查證）。
- **entitlements 與 profile 不一致**：App 一啟動就會被系統終止。驗證時要逐項比對（推論）。
- **App Sandbox 不開**：Developer ID 不強制開沙盒，而論壇有沙盒 App 連不上 CloudKit 的未解回報（推論）。
- **Rust 端沒有現成外掛**：要用 objc2 系列套件呼叫 Security、Foundation、CloudKit。
- **Windows 不同步**：已在目標內寫明。

## 需要的 entitlements（推論，實驗時逐項確認）
以下鍵名都以 `com.apple.developer.` 開頭：
- `application-identifier`、`team-identifier`
- `icloud-services`＝CloudKit、`icloud-container-identifiers`＝iCloud.com.sayit.app、`icloud-container-environment`＝Production
- `ubiquity-kvstore-identifier`＝`<TeamID>.com.sayit.app`
- `keychain-access-groups`＝`<TeamID>.com.sayit.app`

現況：`src-tauri/Entitlements.plist` 只有麥克風與 Apple Events，沒有 profile。

## 最小驗證實驗（★＝要使用者在 Apple Developer 網站操作）
1. ★ App ID `com.sayit.app` 打開 iCloud（含 CloudKit）。
2. ★ 建立 iCloud container `iCloud.com.sayit.app`，指派給這個 App ID。
3. ★ 建立 Developer ID provisioning profile，綁定這個 App ID 與現有的 Developer ID 憑證，下載後交給我（profile 不含私鑰）。
4. 在實驗分支：加 entitlements、內嵌 profile，再寫一個測試指令，分別讀寫一筆鑰匙圈同步項目、一筆鍵值、一筆 CloudKit 紀錄。
5. 本機用 Developer ID 簽章打包。用 `codesign -d --entitlements` 對照 `security cms -D -i` 解出的 profile，再跑 `spctl -a -vv`，最後實際啟動，確認不會閃退。
6. 公證並 staple，再跑一次 spctl。
7. 在第二台登入同一個 Apple ID 的 Mac 上確認三種資料都同步過來。若沒有第二台，至少確認 CloudKit Console 裡看得到資料。
8. ★ 在 CloudKit Console 把 schema 部署到 Production，再驗一次。
9. 前面都通過才改 CI，用測試版走一次 release 流程。

## 停點
- 步驟 1–3、8 要你在 Apple Developer 網站操作。
- 步驟 4 會新增權限（iCloud entitlements），依目標約定要先經你同意。

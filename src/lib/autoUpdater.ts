import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateCheckResult {
  status: "up-to-date" | "update-available" | "error";
  version?: string;
  error?: string;
}

/**
 * 檢查 App 更新。
 * - 背景呼叫時靜默處理錯誤
 * - 手動呼叫時回傳結果供 UI 通知使用者
 */
export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  try {
    const update = await check();
    if (!update) {
      console.log("[autoUpdater] No update available");
      return { status: "up-to-date" };
    }

    console.log(`[autoUpdater] Update available: v${update.version}`);

    await update.download();
    console.log("[autoUpdater] Update downloaded");

    const shouldRestart = window.confirm(
      `SayIt v${update.version} 已下載完成。\n重啟以安裝更新？`,
    );

    if (shouldRestart) {
      await update.install();
      await relaunch();
    }

    return { status: "update-available", version: update.version };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[autoUpdater] Update check failed:", message);
    return { status: "error", error: message };
  }
}

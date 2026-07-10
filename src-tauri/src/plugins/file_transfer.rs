//! 通用文字檔讀寫指令，供備份匯出／匯入使用。
//!
//! 路徑由前端原生對話框（`@tauri-apps/plugin-dialog`）取得後傳入，實際檔案 I/O 在
//! Rust 端執行。為避免這兩個指令淪為「可讀寫任意路徑」的旁路，Rust 端會把目標路徑
//! 限制在使用者標準目錄（下載 / 文件 / 桌面）之內——備份對話框本就落在這些目錄，
//! 落在其外或經 symlink 的路徑一律拒絕。

use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// 允許讀寫的根目錄白名單：下載 / 文件 / 桌面。
/// 刻意**不含**整個 home——home 是三者的超集，會讓 `~/.ssh`、`~/.aws`、shell rc、
/// autostart 等敏感檔落入可讀寫範圍；備份對話框本就落在下載／文件／桌面。
fn allowed_base_dirs(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let resolver = app.path();
    [
        resolver.download_dir(),
        resolver.document_dir(),
        resolver.desktop_dir(),
    ]
    .into_iter()
    .flatten()
    .filter_map(|dir| dir.canonicalize().ok())
    .collect()
}

/// 確認目標路徑落在白名單目錄樹內。存檔目標可能尚未存在 → 改檢查其父目錄。
fn assert_path_allowed(app: &tauri::AppHandle, target: &Path) -> Result<(), String> {
    // 目標本身若為 symlink（含 dangling symlink），最終路徑元件可能經 symlink 逃逸
    // 白名單（父目錄 canonicalize 檢查涵蓋不到 leaf）→ 一律拒絕；正常備份檔不是 symlink。
    if let Ok(meta) = std::fs::symlink_metadata(target) {
        if meta.file_type().is_symlink() {
            return Err("Symlinked target is not allowed".to_string());
        }
    }
    let probe = if target.exists() {
        target.to_path_buf()
    } else {
        target
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "Invalid path".to_string())?
    };
    let canonical = probe
        .canonicalize()
        .map_err(|_| "Invalid or inaccessible path".to_string())?;
    let bases = allowed_base_dirs(app);
    if bases.iter().any(|base| canonical.starts_with(base)) {
        Ok(())
    } else {
        Err("Path is outside the allowed user directories".to_string())
    }
}

/// 備份檔大小上限（位元組），對齊前端 `settingsTransfer.ts` 的 `MAX_BACKUP_FILE_BYTES`。
const MAX_BACKUP_FILE_BYTES: u64 = 8 * 1024 * 1024;

/// 將文字內容寫入指定路徑（覆寫）。路徑須落在白名單目錄樹內。
#[tauri::command]
pub fn save_text_file(
    app: tauri::AppHandle,
    path: String,
    content: String,
) -> Result<(), String> {
    let target = PathBuf::from(&path);
    assert_path_allowed(&app, &target)?;
    std::fs::write(&target, content).map_err(|e| format!("Failed to write file: {e}"))
}

/// 讀取指定路徑的文字檔。
///
/// 以開啟後的 handle metadata 確認為一般檔案並檢查大小，再以 cap 後的 reader
/// （`take(MAX + 1)`）讀取——即使 metadata 檢查與實際讀取之間檔案被替換（TOCTOU），
/// 也不會讀入超過上限的內容。超過上限回傳符號錯誤 `"FILE_TOO_LARGE"`
/// （前端據此對應 `settings.backup.errorTooLarge`）。
#[tauri::command]
pub fn read_text_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let target = PathBuf::from(&path);
    assert_path_allowed(&app, &target)?;
    let file = std::fs::File::open(&target).map_err(|e| format!("Failed to open file: {e}"))?;
    let metadata = file
        .metadata()
        .map_err(|e| format!("Failed to read file metadata: {e}"))?;
    if !metadata.is_file() {
        return Err("Not a regular file".to_string());
    }
    if metadata.len() > MAX_BACKUP_FILE_BYTES {
        return Err("FILE_TOO_LARGE".to_string());
    }
    let mut buf = Vec::new();
    file.take(MAX_BACKUP_FILE_BYTES + 1)
        .read_to_end(&mut buf)
        .map_err(|e| format!("Failed to read file: {e}"))?;
    if buf.len() as u64 > MAX_BACKUP_FILE_BYTES {
        return Err("FILE_TOO_LARGE".to_string());
    }
    String::from_utf8(buf).map_err(|_| "Invalid UTF-8 in file".to_string())
}

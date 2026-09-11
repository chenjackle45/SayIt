//! 除錯記錄（Debug Log）相關 command。
//!
//! 檔案 Log 由官方 `tauri-plugin-log` 寫入 `app_log_dir()`；本模組提供：
//! - `FILE_LOG_ENABLED`：執行期開關旗標，由 plugin-log **檔案 target** 的 `.filter` 讀取（見 `lib.rs`）。
//! - `GatedLogger`：包在 plugin logger 外的薄殼，每筆寫入持有 `LOG_GATE`；
//!   切換開關與清檔也拿同一把鎖，讓「在途寫入 → 關旗標 → 清檔」成為嚴格順序。
//! - `set_file_logging_enabled`：前端設定開關時即時切換（免重啟）；關閉時順手清掉既有記錄檔。
//! - `open_log_folder`：以系統檔案管理員開啟 Log 資料夾。

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{command, AppHandle, Manager};

/// 檔案 Log 開關旗標。預設關閉，由前端 `set_file_logging_enabled` 設定。
/// `tauri-plugin-log` 檔案 target 的 `.filter` 會讀取此旗標決定是否寫檔。
pub static FILE_LOG_ENABLED: AtomicBool = AtomicBool::new(false);

/// 寫入與清檔共用的閘。plugin 的 filter 判定與實際寫入不共用鎖，若只關旗標再清檔，
/// 已通過 filter、尚未寫入的那一筆（例如背景轉錄回應）會在清檔後才落地。
/// 每筆 `log()` 全程持鎖，關閉開關時拿到鎖就代表沒有在途寫入。
static LOG_GATE: Mutex<()> = Mutex::new(());

/// plugin-log 的 LogDir 檔名基底（不含副檔名）。active 檔為 `{LOG_FILE_NAME}.log`。
pub const LOG_FILE_NAME: &str = "sayit";

/// 自訂鍵錄製診斷用的記憶體環狀緩衝（gh-30）。與檔案日誌開關無關，關 app 即消失。
/// 只收訊息以 `HOTKEY_DIAG_PREFIXES` 開頭的日誌：這些行只有鍵碼、修飾鍵、階段與固定文字，
/// 沒有任何轉錄內容——白名單是資料來源的約束，不是內容消毒。
const HOTKEY_DIAG_PREFIXES: [&str; 2] = ["[hotkey-listener]", "[SettingsView] hotkey"];
const HOTKEY_DIAG_CAPACITY: usize = 200;
static HOTKEY_DIAG_BUFFER: Mutex<VecDeque<String>> = Mutex::new(VecDeque::new());

/// 把一筆日誌（已格式化的訊息）依白名單收進緩衝；不在 `LOG_GATE` 內呼叫、只持緩衝自己的鎖。
fn push_hotkey_diagnostic(level: log::Level, message: &str) {
    if !HOTKEY_DIAG_PREFIXES.iter().any(|p| message.starts_with(p)) {
        return;
    }
    // 不引新依賴：時間戳是「自第一筆白名單日誌起算的毫秒」（不是 app 啟動），看事件間隔與順序夠用
    static START: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
    let elapsed_ms = START.get_or_init(std::time::Instant::now).elapsed().as_millis();
    let line = format!("+{elapsed_ms}ms {level} {message}");
    if let Ok(mut buf) = HOTKEY_DIAG_BUFFER.lock() {
        if buf.len() >= HOTKEY_DIAG_CAPACITY {
            buf.pop_front();
        }
        buf.push_back(line);
    }
}

/// 回傳自訂鍵錄製診斷緩衝的快照（不清空：先複製再開 GitHub 仍是同一批）。
#[command]
pub fn get_hotkey_recording_diagnostics() -> Vec<String> {
    HOTKEY_DIAG_BUFFER
        .lock()
        .map(|buf| buf.iter().cloned().collect())
        .unwrap_or_default()
}

/// 包住 plugin logger：每筆寫入持有 `LOG_GATE`。鎖內不呼叫全域 `log::*`（會重入死鎖）。
pub struct GatedLogger {
    inner: Box<dyn log::Log>,
}

impl GatedLogger {
    pub fn new(inner: Box<dyn log::Log>) -> Self {
        Self { inner }
    }
}

impl log::Log for GatedLogger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        self.inner.enabled(metadata)
    }

    fn log(&self, record: &log::Record) {
        // gh-30：診斷緩衝在 LOG_GATE 之外做，避免巢狀持鎖拉長 hook 執行緒的等待。
        // 純字串訊息（webview 轉送、無格式引數）用 as_str() 借用，免配置；其餘才格式化
        match record.args().as_str() {
            Some(msg) => push_hotkey_diagnostic(record.level(), msg),
            None => push_hotkey_diagnostic(record.level(), &record.args().to_string()),
        }
        let _guard = LOG_GATE.lock().expect("log gate poisoned");
        self.inner.log(record);
    }

    fn flush(&self) {
        self.inner.flush();
    }
}

/// 設定是否開啟檔案 Log 記錄（即時生效，免重啟）。
///
/// 關閉時清掉既有記錄檔：記錄檔含逐字稿與 AI 整理結果，使用者送完回報就會關掉開關，
/// 這一刻就是「不想再留檔」的意思。等鎖與檔案操作放在 blocking 執行緒，不占主執行緒。
/// 清檔失敗回 Err（旗標仍已關、之後不會再寫），由前端提示。
#[command]
pub async fn set_file_logging_enabled(enabled: bool, app: AppHandle) -> Result<(), String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to get log dir: {e}"))?;
    let result = tauri::async_runtime::spawn_blocking(move || apply_enabled(enabled, &log_dir))
        .await
        .map_err(|e| format!("Logging task failed: {e}"))?;
    // 鎖已釋放，才能寫日誌
    log::info!(
        "[logging] File logging {}",
        if enabled { "enabled" } else { "disabled" }
    );
    result
}

/// 持 `LOG_GATE` 切換旗標；關閉時在同一把鎖內清檔，確保沒有在途寫入落在清檔之後。
fn apply_enabled(enabled: bool, log_dir: &Path) -> Result<(), String> {
    let _guard = LOG_GATE.lock().expect("log gate poisoned");
    FILE_LOG_ENABLED.store(enabled, Ordering::SeqCst);
    if enabled {
        return Ok(());
    }
    clear_log_files(log_dir)
}

/// 清掉 `dir` 下所有 `{LOG_FILE_NAME}*.log`：active 檔（plugin 仍持有 append handle）只截斷
/// 不刪除——之後若再開啟記錄，append 會接在新的 EOF（偏移 0）；輪替檔直接刪除。
fn clear_log_files(dir: &Path) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    let active_file = format!("{LOG_FILE_NAME}.log");
    for entry in std::fs::read_dir(dir).map_err(|e| format!("Failed to read log dir: {e}"))? {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if !name.starts_with(LOG_FILE_NAME) || path.extension().is_none_or(|ext| ext != "log") {
            continue;
        }
        let result = if name == active_file {
            std::fs::File::create(&path).map(|_| ())
        } else {
            std::fs::remove_file(&path)
        };
        if let Err(e) = result {
            return Err(format!("Failed to clear {}: {e}", path.display()));
        }
    }
    Ok(())
}

/// 以系統檔案管理員開啟 Log 資料夾（macOS `open`、Windows `explorer`）。
#[command]
pub fn open_log_folder(app: AppHandle) -> Result<(), String> {
    let log_dir: PathBuf = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to get log dir: {e}"))?;

    // 首次尚未產生任何 log 時資料夾可能不存在，先建立避免開啟失敗。
    if !log_dir.exists() {
        std::fs::create_dir_all(&log_dir).map_err(|e| format!("Failed to create log dir: {e}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&log_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&log_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use std::sync::mpsc;
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "sayit-logging-test-{tag}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn clear_truncates_active_removes_rotated_keeps_others() {
        let dir = temp_dir("clear");
        fs::write(dir.join("sayit.log"), "逐字稿一行").unwrap();
        fs::write(dir.join("sayit_2026-09-10.log"), "舊輪替").unwrap();
        fs::write(dir.join("notes.txt"), "不相關").unwrap();
        fs::write(dir.join("other.log"), "別的程式的檔").unwrap();

        clear_log_files(&dir).unwrap();

        assert_eq!(fs::read_to_string(dir.join("sayit.log")).unwrap(), "");
        assert!(!dir.join("sayit_2026-09-10.log").exists());
        assert_eq!(fs::read_to_string(dir.join("notes.txt")).unwrap(), "不相關");
        assert_eq!(
            fs::read_to_string(dir.join("other.log")).unwrap(),
            "別的程式的檔"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn append_handle_writes_from_offset_zero_after_truncate() {
        // 模擬 plugin 持有的 append handle：截斷後再寫，內容不得有 NUL 洞
        let dir = temp_dir("append");
        let path = dir.join("sayit.log");
        let mut handle = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .unwrap();
        handle.write_all(b"old line\n").unwrap();

        clear_log_files(&dir).unwrap();
        handle.write_all(b"new").unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"new");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn clear_on_missing_dir_is_ok() {
        let dir = std::env::temp_dir().join("sayit-logging-test-missing-dir-does-not-exist");
        assert!(clear_log_files(&dir).is_ok());
    }

    /// 假的內層 logger：寫入時先通知測試「已進入寫入」，再等測試放行，
    /// 讓「在途寫入 vs 關閉清檔」的時序可控。寫入當下順便記錄旗標值：
    /// 有閘的話，關閉那一方拿不到鎖、旗標必定還是 true。
    struct BlockingSink {
        entered: mpsc::Sender<()>,
        release: Mutex<mpsc::Receiver<()>>,
        path: PathBuf,
        flag_seen_at_write: mpsc::Sender<bool>,
    }

    impl log::Log for BlockingSink {
        fn enabled(&self, _: &log::Metadata) -> bool {
            true
        }
        fn log(&self, record: &log::Record) {
            self.entered.send(()).unwrap();
            self.release
                .lock()
                .unwrap()
                .recv_timeout(Duration::from_secs(5))
                .expect("測試未放行寫入");
            self.flag_seen_at_write
                .send(FILE_LOG_ENABLED.load(Ordering::SeqCst))
                .unwrap();
            let mut f = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.path)
                .unwrap();
            writeln!(f, "{}", record.args()).unwrap();
        }
        fn flush(&self) {}
    }

    #[test]
    fn disable_waits_for_in_flight_write_then_clears() {
        let dir = temp_dir("gate");
        let path = dir.join("sayit.log");
        FILE_LOG_ENABLED.store(true, Ordering::SeqCst);
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let (flag_tx, flag_rx) = mpsc::channel();
        let logger = Arc::new(GatedLogger::new(Box::new(BlockingSink {
            entered: entered_tx,
            release: Mutex::new(release_rx),
            path: path.clone(),
            flag_seen_at_write: flag_tx,
        })));

        // 在途寫入：已通過 filter、正在 log()，卡在寫入前
        let writer = {
            let logger = Arc::clone(&logger);
            thread::spawn(move || {
                log::Log::log(
                    &*logger,
                    &log::Record::builder()
                        .args(format_args!("逐字稿：這句不能留在檔案裡"))
                        .level(log::Level::Info)
                        .build(),
                );
            })
        };
        entered_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("寫入端未進入 log()");

        // 另一執行緒關閉開關：必須等在途寫入結束才能清檔
        let (done_tx, done_rx) = mpsc::channel();
        let disabler = {
            let dir = dir.clone();
            thread::spawn(move || {
                let r = apply_enabled(false, &dir);
                done_tx.send(()).unwrap();
                r
            })
        };
        // 給關閉端足夠時間跑到取鎖；沒有閘的話它會在這段時間內清完檔並返回
        assert!(
            done_rx.recv_timeout(Duration::from_millis(200)).is_err(),
            "關閉不該在在途寫入完成前返回"
        );

        release_tx.send(()).unwrap();
        writer.join().unwrap();
        // 寫入當下旗標仍為 true：關閉端確實被閘擋在外面（沒有閘會看到 false）
        assert!(flag_rx.recv_timeout(Duration::from_secs(5)).unwrap());
        assert!(
            done_rx.recv_timeout(Duration::from_secs(5)).is_ok(),
            "關閉端未在寫入結束後完成"
        );
        disabler.join().unwrap().unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "");
        assert!(!FILE_LOG_ENABLED.load(Ordering::SeqCst));
        let _ = fs::remove_dir_all(&dir);
    }
    /// gh-30：用真的 GatedLogger 餵前端轉送形狀的 record（target=webview、訊息原樣在 args）
    struct NullLog;
    impl log::Log for NullLog {
        fn enabled(&self, _: &log::Metadata) -> bool {
            true
        }
        fn log(&self, _: &log::Record) {}
        fn flush(&self) {}
    }

    fn feed(logger: &GatedLogger, target: &str, msg: &str) {
        use log::Log;
        logger.log(
            &log::Record::builder()
                .level(log::Level::Info)
                .target(target)
                .args(format_args!("{msg}"))
                .build(),
        );
    }

    #[test]
    fn hotkey_diag_buffer_whitelist_capacity_and_snapshot() {
        HOTKEY_DIAG_BUFFER.lock().unwrap().clear();
        let logger = GatedLogger::new(Box::new(NullLog));

        feed(&logger, "sayit", "[transcription] Response: \"這是逐字稿\"");
        feed(&logger, "webview", "[SettingsView] hotkey recording: listeners ready");
        feed(&logger, "sayit", "[hotkey-listener] recording: vk=0x4B down=true");
        feed(&logger, "webview", "[VoiceFlow] enhancement done");

        let snap = get_hotkey_recording_diagnostics();
        assert_eq!(snap.len(), 2, "只有白名單前綴進緩衝");
        assert!(snap[0].ends_with("INFO [SettingsView] hotkey recording: listeners ready"));
        assert!(snap[1].contains("[hotkey-listener] recording: vk=0x4B"));
        assert!(snap.iter().all(|l| !l.contains("逐字稿")));

        // 快照不清空
        assert_eq!(get_hotkey_recording_diagnostics().len(), 2);

        // 上限：塞滿後淘汰最舊
        for i in 0..(HOTKEY_DIAG_CAPACITY + 5) {
            feed(&logger, "sayit", &format!("[hotkey-listener] filler {i}"));
        }
        let snap = get_hotkey_recording_diagnostics();
        assert_eq!(snap.len(), HOTKEY_DIAG_CAPACITY);
        // 2 行原始 + 205 行 filler = 207，淘汰最舊 7 行：2 行原始與 filler 0..=4
        assert!(snap[0].contains("filler 5"), "got {}", snap[0]);
        assert!(!snap.iter().any(|l| l.contains("listeners ready")));
        HOTKEY_DIAG_BUFFER.lock().unwrap().clear();
    }

}

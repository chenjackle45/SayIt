use std::sync::Mutex;

use tauri::{command, State};

/// 系統音量控制狀態
///
/// `was_muted_before`: None = 沒有 pending restore（初始/已恢復狀態）
///                     Some(true) = 錄音前系統已靜音
///                     Some(false) = 錄音前系統未靜音
pub struct AudioControlState {
    was_muted_before: Mutex<Option<bool>>,
}

impl AudioControlState {
    pub fn new() -> Self {
        Self {
            was_muted_before: Mutex::new(None),
        }
    }

    pub fn shutdown(&self) {
        let mut guard = match self.was_muted_before.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        if let Some(was_muted) = guard.take() {
            let _ = platform_set_system_mute(was_muted);
            println!("[audio-control] shutdown: restored system audio");
        }
    }
}

// ========== macOS CoreAudio Implementation ==========

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::c_void;

    #[repr(C)]
    struct AudioObjectPropertyAddress {
        m_selector: u32,
        m_scope: u32,
        m_element: u32,
    }

    extern "C" {
        fn AudioObjectGetPropertyData(
            in_object_id: u32,
            in_address: *const AudioObjectPropertyAddress,
            in_qualifier_data_size: u32,
            in_qualifier_data: *const c_void,
            io_data_size: *mut u32,
            out_data: *mut c_void,
        ) -> i32;

        fn AudioObjectSetPropertyData(
            in_object_id: u32,
            in_address: *const AudioObjectPropertyAddress,
            in_qualifier_data_size: u32,
            in_qualifier_data: *const c_void,
            in_data_size: u32,
            in_data: *const c_void,
        ) -> i32;
    }

    // FourCC 常數（big-endian byte order）
    const K_AUDIO_HARDWARE_PROPERTY_DEFAULT_OUTPUT_DEVICE: u32 = 0x644F7574; // 'dOut'
    const K_AUDIO_DEVICE_PROPERTY_MUTE: u32 = 0x6D757465; // 'mute'
    const K_AUDIO_OBJECT_PROPERTY_SCOPE_OUTPUT: u32 = 0x6F757470; // 'outp'
    const K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL: u32 = 0x676C6F62; // 'glob'
    const K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN: u32 = 0;
    const K_AUDIO_OBJECT_SYSTEM_OBJECT: u32 = 1;

    fn get_default_output_device() -> Option<u32> {
        let address = AudioObjectPropertyAddress {
            m_selector: K_AUDIO_HARDWARE_PROPERTY_DEFAULT_OUTPUT_DEVICE,
            m_scope: K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL,
            m_element: K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN,
        };

        let mut device_id: u32 = 0;
        let mut data_size: u32 = std::mem::size_of::<u32>() as u32;

        let status = unsafe {
            AudioObjectGetPropertyData(
                K_AUDIO_OBJECT_SYSTEM_OBJECT,
                &address,
                0,
                std::ptr::null(),
                &mut data_size,
                &mut device_id as *mut u32 as *mut c_void,
            )
        };

        if status != 0 {
            eprintln!(
                "[audio-control] Failed to get default output device: OSStatus {status}"
            );
            return None;
        }

        Some(device_id)
    }

    fn get_device_mute(device_id: u32) -> Result<bool, String> {
        let address = AudioObjectPropertyAddress {
            m_selector: K_AUDIO_DEVICE_PROPERTY_MUTE,
            m_scope: K_AUDIO_OBJECT_PROPERTY_SCOPE_OUTPUT,
            m_element: K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN,
        };

        let mut mute_value: u32 = 0;
        let mut data_size: u32 = std::mem::size_of::<u32>() as u32;

        let status = unsafe {
            AudioObjectGetPropertyData(
                device_id,
                &address,
                0,
                std::ptr::null(),
                &mut data_size,
                &mut mute_value as *mut u32 as *mut c_void,
            )
        };

        if status != 0 {
            return Err(format!("Failed to get mute state: OSStatus {status}"));
        }

        Ok(mute_value != 0)
    }

    fn set_device_mute(device_id: u32, muted: bool) -> Result<(), String> {
        let address = AudioObjectPropertyAddress {
            m_selector: K_AUDIO_DEVICE_PROPERTY_MUTE,
            m_scope: K_AUDIO_OBJECT_PROPERTY_SCOPE_OUTPUT,
            m_element: K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN,
        };

        let mute_value: u32 = if muted { 1 } else { 0 };
        let data_size: u32 = std::mem::size_of::<u32>() as u32;

        let status = unsafe {
            AudioObjectSetPropertyData(
                device_id,
                &address,
                0,
                std::ptr::null(),
                data_size,
                &mute_value as *const u32 as *const c_void,
            )
        };

        if status != 0 {
            return Err(format!("Failed to set mute state: OSStatus {status}"));
        }

        Ok(())
    }

    pub fn get_system_mute() -> Result<bool, String> {
        let device_id = get_default_output_device().ok_or("No default output device found")?;
        get_device_mute(device_id)
    }

    pub fn set_system_mute(muted: bool) -> Result<(), String> {
        let device_id = get_default_output_device().ok_or("No default output device found")?;
        set_device_mute(device_id, muted)
    }
}

// ========== Windows WASAPI Implementation ==========

#[cfg(target_os = "windows")]
mod windows_audio {
    use windows::core::Interface;
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };

    /// COM scope guard：離開 scope 時自動 CoUninitialize（若此次呼叫有成功 init）
    struct ComGuard {
        should_uninit: bool,
    }

    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.should_uninit {
                unsafe { CoUninitialize() };
            }
        }
    }

    /// 初始化 COM 並回傳 scope guard。guard 必須存活到 COM 操作全部完成。
    fn init_com() -> Result<ComGuard, String> {
        unsafe {
            // windows crate 0.61: CoInitializeEx 回傳 HRESULT
            // S_OK (0) / S_FALSE (1) → 需要配對 CoUninitialize
            // RPC_E_CHANGED_MODE (0x80010106) → 已在其他模式 init，不需 CoUninitialize
            let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            if hr.is_ok() {
                Ok(ComGuard {
                    should_uninit: true,
                })
            } else {
                let code = hr.0 as u32;
                if code == 0x80010106 {
                    println!(
                        "[audio-control] COM already initialized in different mode, continuing"
                    );
                    Ok(ComGuard {
                        should_uninit: false,
                    })
                } else {
                    Err(format!("CoInitializeEx failed: HRESULT 0x{:08X}", code))
                }
            }
        }
    }

    fn get_default_endpoint_volume() -> Result<IAudioEndpointVolume, String> {
        unsafe {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| format!("CoCreateInstance(MMDeviceEnumerator) failed: {}", e))?;

            let device = enumerator
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .map_err(|e| format!("GetDefaultAudioEndpoint failed: {}", e))?;

            device
                .Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
                .map_err(|e| format!("Activate(IAudioEndpointVolume) failed: {}", e))
        }
    }

    pub fn get_system_mute() -> Result<bool, String> {
        unsafe {
            let _com = init_com()?;
            let volume = get_default_endpoint_volume()?;
            let muted = volume
                .GetMute()
                .map_err(|e| format!("GetMute failed: {}", e))?;
            Ok(muted.as_bool())
        }
    }

    pub fn set_system_mute(muted: bool) -> Result<(), String> {
        unsafe {
            let _com = init_com()?;
            let volume = get_default_endpoint_volume()?;
            volume
                .SetMute(muted, std::ptr::null())
                .map_err(|e| format!("SetMute failed: {}", e))
        }
    }
}

// ========== Platform-agnostic helpers ==========

fn platform_get_system_mute() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        macos::get_system_mute()
    }
    #[cfg(target_os = "windows")]
    {
        windows_audio::get_system_mute()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err("Unsupported platform".to_string())
    }
}

fn platform_set_system_mute(muted: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::set_system_mute(muted)
    }
    #[cfg(target_os = "windows")]
    {
        windows_audio::set_system_mute(muted)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = muted;
        Err("Unsupported platform".to_string())
    }
}

// ========== Tauri Commands ==========

#[command]
pub fn mute_system_audio(state: State<AudioControlState>) -> Result<(), String> {
    let mut guard = state
        .was_muted_before
        .lock()
        .map_err(|e| format!("Lock poisoned: {e}"))?;

    // 冪等：若已有 pending restore，跳過
    if guard.is_some() {
        println!("[audio-control] mute_system_audio: already muted (pending restore), skipping");
        return Ok(());
    }

    let current_mute = platform_get_system_mute()?;
    platform_set_system_mute(true)?;
    *guard = Some(current_mute);

    println!(
        "[audio-control] mute_system_audio: muted (was_muted_before={current_mute})"
    );
    Ok(())
}

#[command]
pub fn restore_system_audio(state: State<AudioControlState>) -> Result<(), String> {
    let mut guard = state
        .was_muted_before
        .lock()
        .map_err(|e| format!("Lock poisoned: {e}"))?;

    // 冪等：若沒有 pending restore，跳過
    let was_muted = match *guard {
        Some(v) => v,
        None => {
            println!("[audio-control] restore_system_audio: no pending restore, skipping");
            return Ok(());
        }
    };

    // 先清除狀態，避免 restore 失敗導致永久卡在 muted 狀態
    *guard = None;

    if let Err(e) = platform_set_system_mute(was_muted) {
        eprintln!(
            "[audio-control] restore_system_audio: failed to restore (was_muted={was_muted}): {e}"
        );
        return Err(e);
    }

    println!(
        "[audio-control] restore_system_audio: restored (was_muted={was_muted})"
    );
    Ok(())
}

// ========== Tests ==========

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_audio_control_state_new() {
        let state = AudioControlState::new();
        let guard = state.was_muted_before.lock().unwrap();
        assert_eq!(*guard, None);
    }

    #[test]
    fn test_state_transitions() {
        let state = AudioControlState::new();

        // 模擬 mute: None → Some(false)
        {
            let mut guard = state.was_muted_before.lock().unwrap();
            assert!(guard.is_none());
            *guard = Some(false);
        }

        // 模擬 restore: Some(false) → None
        {
            let mut guard = state.was_muted_before.lock().unwrap();
            assert_eq!(*guard, Some(false));
            *guard = None;
        }

        // 確認回到初始狀態
        {
            let guard = state.was_muted_before.lock().unwrap();
            assert_eq!(*guard, None);
        }
    }

    #[test]
    fn test_mute_idempotent_state() {
        let state = AudioControlState::new();

        // 第一次 mute
        {
            let mut guard = state.was_muted_before.lock().unwrap();
            assert!(guard.is_none());
            *guard = Some(false);
        }

        // 第二次 mute（應該跳過，因為已有值）
        {
            let guard = state.was_muted_before.lock().unwrap();
            assert!(guard.is_some()); // 不為 None 表示跳過
        }
    }

    #[test]
    fn test_restore_without_mute_state() {
        let state = AudioControlState::new();

        // 直接 restore（沒有先 mute）
        {
            let guard = state.was_muted_before.lock().unwrap();
            assert!(guard.is_none()); // None 表示跳過 restore
        }
    }

    #[test]
    fn test_state_reset_after_restore() {
        let state = AudioControlState::new();

        // mute
        {
            let mut guard = state.was_muted_before.lock().unwrap();
            *guard = Some(true);
        }

        // restore
        {
            let mut guard = state.was_muted_before.lock().unwrap();
            assert_eq!(*guard, Some(true));
            *guard = None;
        }

        // 確認 reset
        {
            let guard = state.was_muted_before.lock().unwrap();
            assert_eq!(*guard, None);
        }
    }
}

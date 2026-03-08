use tauri::command;

// ========== macOS AudioToolbox Implementation ==========

#[cfg(target_os = "macos")]
mod macos {
    use core_foundation::base::TCFType;
    use core_foundation::url::CFURL;

    type SystemSoundID = u32;
    type OSStatus = i32;

    #[link(name = "AudioToolbox", kind = "framework")]
    extern "C" {
        fn AudioServicesCreateSystemSoundID(
            in_file_url: core_foundation::base::CFTypeRef,
            out_system_sound_id: *mut SystemSoundID,
        ) -> OSStatus;
        fn AudioServicesPlaySystemSound(in_system_sound_id: SystemSoundID);
    }

    fn play_system_sound(path: &str) {
        let url = match CFURL::from_path(std::path::Path::new(path), false) {
            Some(url) => url,
            None => {
                eprintln!("[sound-feedback] Failed to create CFURL for: {}", path);
                return;
            }
        };

        let mut sound_id: SystemSoundID = 0;
        let status = unsafe {
            AudioServicesCreateSystemSoundID(
                url.as_concrete_TypeRef() as core_foundation::base::CFTypeRef,
                &mut sound_id,
            )
        };

        if status != 0 {
            eprintln!(
                "[sound-feedback] AudioServicesCreateSystemSoundID failed: OSStatus {}",
                status
            );
            return;
        }

        unsafe {
            AudioServicesPlaySystemSound(sound_id);
        }
    }

    pub fn play_start_sound() {
        play_system_sound("/System/Library/Sounds/Funk.aiff");
    }

    pub fn play_stop_sound() {
        play_system_sound("/System/Library/Sounds/Bottle.aiff");
    }
}

// ========== Windows PlaySound Implementation ==========

#[cfg(target_os = "windows")]
mod windows_sound {
    use windows::core::PCSTR;
    use windows::Win32::Media::Audio::{PlaySoundA, SND_ASYNC, SND_MEMORY};

    static START_SOUND: &[u8] = include_bytes!("../../resources/sounds/start.wav");
    static STOP_SOUND: &[u8] = include_bytes!("../../resources/sounds/stop.wav");

    pub fn play_start_sound() {
        let ok =
            unsafe { PlaySoundA(PCSTR(START_SOUND.as_ptr()), None, SND_MEMORY | SND_ASYNC) };
        if !ok.as_bool() {
            eprintln!("[sound-feedback] PlaySoundA(start) failed");
        }
    }

    pub fn play_stop_sound() {
        let ok =
            unsafe { PlaySoundA(PCSTR(STOP_SOUND.as_ptr()), None, SND_MEMORY | SND_ASYNC) };
        if !ok.as_bool() {
            eprintln!("[sound-feedback] PlaySoundA(stop) failed");
        }
    }
}

// ========== Platform-agnostic wrappers ==========

fn platform_play_start_sound() {
    #[cfg(target_os = "macos")]
    {
        macos::play_start_sound();
    }
    #[cfg(target_os = "windows")]
    {
        windows_sound::play_start_sound();
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        println!("[sound-feedback] play_start_sound: unsupported platform (no-op)");
    }
}

fn platform_play_stop_sound() {
    #[cfg(target_os = "macos")]
    {
        macos::play_stop_sound();
    }
    #[cfg(target_os = "windows")]
    {
        windows_sound::play_stop_sound();
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        println!("[sound-feedback] play_stop_sound: unsupported platform (no-op)");
    }
}

// ========== Tauri Commands ==========

#[command]
pub fn play_start_sound() {
    platform_play_start_sound();
}

#[command]
pub fn play_stop_sound() {
    platform_play_stop_sound();
}

// ========== Tests ==========

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_play_start_sound_callable() {
        // 驗證函式可呼叫且不 panic（實際音效播放依賴系統，CI 上為 no-op 或靜默失敗）
        platform_play_start_sound();
    }

    #[test]
    fn test_play_stop_sound_callable() {
        platform_play_stop_sound();
    }
}

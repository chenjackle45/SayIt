import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import type { Ref } from "vue";
import { createI18n } from "vue-i18n";
import zhTW from "../../src/i18n/locales/zh-TW.json";

const { mockInvoke, mockCaptureError } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockCaptureError: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
vi.mock("../../src/lib/sentry", () => ({ captureError: mockCaptureError }));

import { useAccessibilityPermission } from "../../src/composables/useAccessibilityPermission";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const wrapperList: ReturnType<typeof mount>[] = [];

function mountPermission(active: Ref<boolean>, onGranted?: () => void) {
  let permission!: ReturnType<typeof useAccessibilityPermission>;
  const wrapper = mount(defineComponent({
    setup() {
      permission = useAccessibilityPermission(active, onGranted);
      return () => h("div");
    },
  }), {
    global: {
      plugins: [createI18n({
        legacy: false,
        locale: "zh-TW",
        messages: { "zh-TW": zhTW },
      })],
    },
  });
  wrapperList.push(wrapper);
  return { permission, wrapper };
}

describe("useAccessibilityPermission", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockInvoke.mockReset().mockImplementation((command: string) =>
      Promise.resolve(command === "check_accessibility_permission_command" ? false : undefined),
    );
    mockCaptureError.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    wrapperList.splice(0).forEach((wrapper) => wrapper.unmount());
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("停用時不檢查；啟用立即檢查並每兩秒輪詢，停用即停止", async () => {
    const active = ref(false);
    mountPermission(active);
    expect(mockInvoke).not.toHaveBeenCalled();

    active.value = true;
    expect(mockInvoke).toHaveBeenCalledExactlyOnceWith("check_accessibility_permission_command");
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1999);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mockInvoke).toHaveBeenCalledTimes(2);

    active.value = false;
    await vi.advanceTimersByTimeAsync(6000);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("初始已授權也先重啟監聽，成功後才回報完成並停止輪詢", async () => {
    const reinitialize = deferred<void>();
    mockInvoke.mockImplementation((command: string) => command === "check_accessibility_permission_command"
      ? Promise.resolve(true)
      : reinitialize.promise);
    const onGranted = vi.fn();
    const { permission } = mountPermission(ref(true), onGranted);
    await flushPromises();
    expect(permission.isReinitializing.value).toBe(true);
    expect(permission.hasPermission.value).toBe(false);
    expect(onGranted).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(6000);
    expect(mockInvoke).toHaveBeenCalledTimes(2);

    reinitialize.resolve();
    await flushPromises();
    expect(permission.isReinitializing.value).toBe(false);
    expect(permission.hasPermission.value).toBe(true);
    expect(onGranted).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6000);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("輪詢發現 false 轉為 true 時重啟，沒有回呼也可完成", async () => {
    mockInvoke.mockResolvedValueOnce(false).mockResolvedValueOnce(true).mockResolvedValueOnce(undefined);
    const { permission } = mountPermission(ref(true));
    await flushPromises();
    expect(permission.hasPermission.value).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockInvoke).toHaveBeenLastCalledWith("reinitialize_hotkey_listener");
    expect(permission.hasPermission.value).toBe(true);
    expect(permission.reinitializeError.value).toBeNull();
    expect(mockCaptureError).not.toHaveBeenCalled();
  });

  it("重新啟用時重新確認權限，不沿用上一輪的完成狀態", async () => {
    mockInvoke.mockResolvedValueOnce(true).mockResolvedValueOnce(undefined).mockResolvedValueOnce(false);
    const active = ref(true);
    const { permission } = mountPermission(active);
    await flushPromises();
    expect(permission.hasPermission.value).toBe(true);
    active.value = false;
    expect(permission.hasPermission.value).toBe(false);
    active.value = true;
    await flushPromises();
    expect(permission.hasPermission.value).toBe(false);
  });

  it("權限檢查失敗保留錯誤上報並繼續輪詢", async () => {
    const error = new Error("權限查詢失敗");
    mockInvoke.mockRejectedValueOnce(error);
    const { permission } = mountPermission(ref(true));
    await flushPromises();
    expect(mockCaptureError).toHaveBeenCalledExactlyOnceWith(error, {
      source: "accessibility", step: "check-permission",
    });
    expect(console.error).toHaveBeenCalledWith("[accessibility-guide] Permission check failed:", error);
    expect(permission.reinitializeError.value).toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("重啟失敗顯示既有翻譯，不回報完成；重新啟用會清除錯誤", async () => {
    const error = new Error("重啟失敗");
    mockInvoke.mockResolvedValueOnce(true).mockRejectedValueOnce(error);
    const active = ref(true);
    const onGranted = vi.fn();
    const { permission } = mountPermission(active, onGranted);
    await flushPromises();
    expect(permission.hasPermission.value).toBe(false);
    expect(permission.isReinitializing.value).toBe(false);
    expect(permission.reinitializeError.value).toBe(zhTW.accessibility.reinitializeError);
    expect(onGranted).not.toHaveBeenCalled();
    expect(mockCaptureError).toHaveBeenCalledExactlyOnceWith(error, {
      source: "accessibility", step: "reinitialize",
    });
    expect(console.error).toHaveBeenCalledWith("[accessibility-guide] Reinitialize failed:", error);
    await vi.advanceTimersByTimeAsync(6000);
    expect(mockInvoke).toHaveBeenCalledTimes(2);

    active.value = false;
    active.value = true;
    expect(permission.reinitializeError.value).toBeNull();
    await flushPromises();
    expect(mockInvoke).toHaveBeenCalledTimes(3);
  });

  it("開啟系統設定沿用 IPC，失敗保留錯誤上報", async () => {
    const { permission } = mountPermission(ref(false));
    await permission.openSettings();
    expect(mockInvoke).toHaveBeenCalledExactlyOnceWith("open_accessibility_settings");
    const error = new Error("設定無法開啟");
    mockInvoke.mockRejectedValueOnce(error);
    await expect(permission.openSettings()).resolves.toBeUndefined();
    expect(mockCaptureError).toHaveBeenCalledExactlyOnceWith(error, {
      source: "accessibility", step: "open-settings",
    });
    expect(console.error).toHaveBeenCalledWith("[accessibility-guide] Failed to open settings:", error);
  });

  it("慢速 IPC 不會因下一次輪詢而重複送出查詢", async () => {
    const check = deferred<boolean>();
    mockInvoke.mockReturnValueOnce(check.promise);
    mountPermission(ref(true));
    await vi.advanceTimersByTimeAsync(6000);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    check.resolve(false);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("關閉後立即重開，舊權限查詢晚回不得重啟或回報完成", async () => {
    const oldCheck = deferred<boolean>();
    mockInvoke.mockReturnValueOnce(oldCheck.promise).mockResolvedValueOnce(false);
    const active = ref(true);
    const onGranted = vi.fn();
    const { permission } = mountPermission(active, onGranted);
    active.value = false;
    active.value = true;
    await flushPromises();
    oldCheck.resolve(true);
    await flushPromises();
    expect(mockInvoke).not.toHaveBeenCalledWith("reinitialize_hotkey_listener");
    expect(permission.hasPermission.value).toBe(false);
    expect(onGranted).not.toHaveBeenCalled();
  });

  it("舊重啟晚回不得完成新畫面，也不得清除新一輪的處理中狀態", async () => {
    const oldReinitialize = deferred<void>();
    const newReinitialize = deferred<void>();
    mockInvoke.mockResolvedValueOnce(true).mockReturnValueOnce(oldReinitialize.promise)
      .mockResolvedValueOnce(true).mockReturnValueOnce(newReinitialize.promise);
    const active = ref(true);
    const onGranted = vi.fn();
    const { permission } = mountPermission(active, onGranted);
    await flushPromises();
    active.value = false;
    expect(permission.isReinitializing.value).toBe(false);
    active.value = true;
    await flushPromises();
    oldReinitialize.resolve();
    await flushPromises();
    expect(permission.isReinitializing.value).toBe(true);
    expect(permission.hasPermission.value).toBe(false);
    expect(onGranted).not.toHaveBeenCalled();
    newReinitialize.resolve();
    await flushPromises();
    expect(permission.hasPermission.value).toBe(true);
    expect(permission.isReinitializing.value).toBe(false);
    expect(onGranted).toHaveBeenCalledTimes(1);
  });

  it.each(["check", "reinitialize"])("卸載會停止輪詢，%s 在途失敗不更新或回報錯誤", async (stage) => {
    const pending = deferred<boolean>();
    if (stage === "check") mockInvoke.mockReturnValueOnce(pending.promise);
    else mockInvoke.mockResolvedValueOnce(true).mockReturnValueOnce(pending.promise);
    const onGranted = vi.fn();
    const { permission, wrapper } = mountPermission(ref(true), onGranted);
    await flushPromises();
    wrapper.unmount();
    const callCount = mockInvoke.mock.calls.length;
    pending.reject(new Error("離開後才失敗"));
    await flushPromises();
    await vi.advanceTimersByTimeAsync(6000);
    expect(mockInvoke).toHaveBeenCalledTimes(callCount);
    expect(permission.hasPermission.value).toBe(false);
    expect(permission.reinitializeError.value).toBeNull();
    expect(onGranted).not.toHaveBeenCalled();
    expect(mockCaptureError).not.toHaveBeenCalled();
  });
});

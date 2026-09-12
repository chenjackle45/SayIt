// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordingCapturedPayload, RecordingRejectedPayload } from "../../src/types/events";

type Handler<T> = (event: { payload: T }) => void;

// ── 可控的 Tauri 邊界 ──
const invokeCalls: string[] = [];
let startDeferred: { resolve: () => void; reject: (e: unknown) => void } | null = null;
type ListenDeferred = { name: string; ok: () => void; fail: (e: unknown) => void };
const listenDeferreds: ListenDeferred[] = []; // 依註冊順序 settle
const listeners = new Map<string, Set<Handler<unknown>>>();
const unlistenSpy = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    invokeCalls.push(cmd);
    if (cmd === "start_hotkey_recording") {
      return new Promise<void>((resolve, reject) => {
        startDeferred = { resolve, reject };
      });
    }
    return Promise.resolve();
  },
}));

vi.mock("../../src/composables/useTauriEvents", () => ({
  HOTKEY_RECORDING_CAPTURED: "hotkey:recording-captured",
  HOTKEY_RECORDING_REJECTED: "hotkey:recording-rejected",
  listenToEvent: (name: string, handler: Handler<unknown>) =>
    new Promise((resolve, reject) => {
      listenDeferreds.push({
        name,
        ok: () => {
          if (!listeners.has(name)) listeners.set(name, new Set());
          listeners.get(name)!.add(handler);
          resolve(() => {
            unlistenSpy(name);
            listeners.get(name)?.delete(handler);
          });
        },
        fail: reject,
      });
    }),
}));

import { useHotkeyRecordingSession } from "../../src/composables/useHotkeyRecordingSession";

const CAPTURED_K: RecordingCapturedPayload = { keycode: 0x4b, modifiers: [], chordKeycodes: [] };
const ESC: RecordingRejectedPayload = { reason: "esc_reserved" };

/** 讓待註冊的 listener 完成（`failNames` 內的改為 reject）並跑完 microtask */
async function settleListeners(failNames: string[] = []) {
  while (listenDeferreds.length) {
    const d = listenDeferreds.shift()!;
    if (failNames.includes(d.name)) d.fail(new Error(`listen failed: ${d.name}`));
    else d.ok();
  }
  for (let i = 0; i < 4; i++) await Promise.resolve();
}
const CAPTURED_EVENT = "hotkey:recording-captured";
const REJECTED_EVENT = "hotkey:recording-rejected";
const liveSessions: Array<{ stop: () => void }> = [];
function emitTauri(name: string, payload: unknown) {
  for (const h of listeners.get(name) ?? []) h({ payload });
}
function domPress(code: string, key: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { code, key, bubbles: true, cancelable: true }));
}
function domRelease(code: string, key: string) {
  window.dispatchEvent(new KeyboardEvent("keyup", { code, key, bubbles: true, cancelable: true }));
}
function makeSession(enableDomSource = true) {
  const cb = {
    onCaptured: vi.fn(),
    onRejected: vi.fn(),
    onTimeout: vi.fn(),
    onStartFailed: vi.fn(),
  };
  const session = useHotkeyRecordingSession({ enableDomSource, ...cb });
  liveSessions.push(session);
  return { session, cb };
}
function terminalCount(cb: ReturnType<typeof makeSession>["cb"]) {
  return (
    cb.onCaptured.mock.calls.length +
    cb.onRejected.mock.calls.length +
    cb.onTimeout.mock.calls.length +
    cb.onStartFailed.mock.calls.length
  );
}
/** 正常走到 Rust 已 start、timeout 已掛 */
async function startAndArm(session: ReturnType<typeof makeSession>["session"]) {
  const p = session.start();
  await settleListeners();
  startDeferred!.resolve();
  await p;
}

describe("useHotkeyRecordingSession（每輪最多一個終態回呼）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.spyOn(console, "info").mockImplementation(() => {});
    invokeCalls.length = 0;
    listenDeferreds.length = 0;
    listeners.clear();
    unlistenSpy.mockClear();
    startDeferred = null;
  });
  afterEach(() => {
    for (const s of liveSessions.splice(0)) s.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("[P0] start() 當下（尚未 await）DOM 監聽已掛上", () => {
    const { session, cb } = makeSession();
    void session.start();
    domPress("KeyK", "k");
    expect(cb.onCaptured).toHaveBeenCalledTimes(1);
    expect(session.isRecording.value).toBe(false);
  });

  it("[P0] enableDomSource=false → 不掛 window 監聽", () => {
    const { session, cb } = makeSession(false);
    void session.start();
    domPress("KeyK", "k");
    expect(cb.onCaptured).not.toHaveBeenCalled();
    expect(session.isRecording.value).toBe(true);
  });

  it("[P0] Tauri 先到、DOM 後到 → onCaptured 一次", async () => {
    const { session, cb } = makeSession();
    await startAndArm(session);
    emitTauri(CAPTURED_EVENT, CAPTURED_K);
    domPress("KeyK", "k");
    expect(terminalCount(cb)).toBe(1);
    expect(cb.onCaptured).toHaveBeenCalledWith(CAPTURED_K);
  });

  it("[P0] DOM 先到、Tauri 後到 → onCaptured 一次、Tauri listener 已卸", async () => {
    const { session, cb } = makeSession();
    await startAndArm(session);
    domPress("KeyK", "k");
    emitTauri(CAPTURED_EVENT, CAPTURED_K);
    expect(terminalCount(cb)).toBe(1);
    expect(unlistenSpy).toHaveBeenCalledTimes(2);
    expect(invokeCalls.filter((c) => c === "cancel_hotkey_recording")).toHaveLength(1);
  });

  it("[P0] 雙來源 ESC → onRejected 一次", async () => {
    const { session, cb } = makeSession();
    await startAndArm(session);
    domPress("Escape", "Escape");
    emitTauri(REJECTED_EVENT, ESC);
    expect(cb.onRejected).toHaveBeenCalledTimes(1);
    expect(terminalCount(cb)).toBe(1);
  });

  it("[P0] ① DOM 在 listener 註冊完成前終結 → 註冊回來自卸、start_hotkey_recording 零次", async () => {
    const { session, cb } = makeSession();
    const p = session.start();
    domPress("KeyK", "k");
    expect(cb.onCaptured).toHaveBeenCalledTimes(1);
    await settleListeners();
    await p;
    expect(unlistenSpy).toHaveBeenCalledTimes(2);
    expect(invokeCalls).not.toContain("start_hotkey_recording");
    expect(listeners.get(CAPTURED_EVENT)?.size ?? 0).toBe(0);
  });

  it("[P0] ② Rust start 已發出、DOM 才終結 → 同步清理、cancel 一次；A 的 start 晚到 resolve 不影響 B", async () => {
    const { session, cb } = makeSession();
    const pA = session.start();
    await settleListeners();
    const startA = startDeferred!;
    domPress("KeyK", "k"); // A 終結
    expect(session.isRecording.value).toBe(false);
    expect(invokeCalls.filter((c) => c === "cancel_hotkey_recording")).toHaveLength(1);

    const pB = session.start(); // 開 B
    await settleListeners();
    const startB = startDeferred!;
    startA.resolve(); // A 的 start 才回來
    await pA;
    expect(session.isRecording.value).toBe(true);
    startB.resolve();
    await pB;
    vi.advanceTimersByTime(10_000); // 只有 B 的 timeout 存在
    expect(cb.onTimeout).toHaveBeenCalledTimes(1);
    expect(terminalCount(cb)).toBe(2); // A captured ＋ B timeout
  });

  it("[P0] A 的 start 晚到 reject → B 不被取消、onStartFailed 不呼叫", async () => {
    const { session, cb } = makeSession();
    const pA = session.start();
    await settleListeners();
    const startA = startDeferred!;
    domPress("KeyK", "k");
    const pB = session.start();
    await settleListeners();
    startA.reject(new Error("late"));
    await pA;
    expect(cb.onStartFailed).not.toHaveBeenCalled();
    expect(session.isRecording.value).toBe(true);
    startDeferred!.resolve();
    await pB;
  });

  it("[P0] 註冊未完成便 stop 再 start B，A 註冊才完成 → A 自卸、不啟動 Rust、B 正常", async () => {
    const { session, cb } = makeSession();
    const pA = session.start();
    session.stop();
    const pB = session.start();
    await settleListeners(); // A 與 B 的註冊一起完成（A 先）
    await pA;
    expect(invokeCalls.filter((c) => c === "start_hotkey_recording")).toHaveLength(1); // 只有 B
    startDeferred!.resolve();
    await pB;
    emitTauri(CAPTURED_EVENT, CAPTURED_K);
    expect(cb.onCaptured).toHaveBeenCalledTimes(1);
  });

  it("[P0] 舊輪 Tauri callback 在 B 開始後到達 → 丟棄", async () => {
    const { session, cb } = makeSession();
    await startAndArm(session);
    const [handlerA] = [...listeners.get(CAPTURED_EVENT)!];
    session.stop();
    await startAndArm(session);
    handlerA({ payload: CAPTURED_K }); // 已卸但模擬排隊中的舊事件
    expect(cb.onCaptured).not.toHaveBeenCalled();
    expect(session.isRecording.value).toBe(true);
  });

  it("[P0] timeout → onTimeout 一次且 cancel 被呼叫；之後 captured 被擋", async () => {
    const { session, cb } = makeSession();
    await startAndArm(session);
    vi.advanceTimersByTime(10_000);
    expect(cb.onTimeout).toHaveBeenCalledTimes(1);
    expect(invokeCalls).toContain("cancel_hotkey_recording");
    emitTauri(CAPTURED_EVENT, CAPTURED_K);
    domPress("KeyK", "k");
    expect(terminalCount(cb)).toBe(1);
  });

  it("[P0] start 失敗 → onStartFailed 一次；captured 與 timeout 都不再觸發", async () => {
    const { session, cb } = makeSession();
    const p = session.start();
    await settleListeners();
    startDeferred!.reject(new Error("boom"));
    await p;
    expect(cb.onStartFailed).toHaveBeenCalledTimes(1);
    emitTauri(CAPTURED_EVENT, CAPTURED_K);
    vi.advanceTimersByTime(10_000);
    expect(terminalCount(cb)).toBe(1);
  });

  it("[P0] 終態回呼內立刻 start() → B 正常完成一輪", async () => {
    const cb = { onCaptured: vi.fn(), onRejected: vi.fn(), onTimeout: vi.fn(), onStartFailed: vi.fn() };
    const session = useHotkeyRecordingSession({
      enableDomSource: true,
      ...cb,
      onCaptured: (p) => {
        cb.onCaptured(p);
        if (cb.onCaptured.mock.calls.length === 1) void session.start();
      },
    });
    await startAndArm(session);
    domPress("KeyK", "k"); // A 終結、回呼內開 B
    expect(session.isRecording.value).toBe(true);
    await settleListeners();
    startDeferred!.resolve();
    await Promise.resolve();
    domPress("KeyC", "c"); // B 完成
    expect(cb.onCaptured).toHaveBeenCalledTimes(2);
    expect(session.isRecording.value).toBe(false);
  });

  it("[P0] listener 一成一敗（兩種順序）→ onStartFailed 一次、成功者已卸、Rust 零次、不再錄製", async () => {
    for (const failName of [REJECTED_EVENT, CAPTURED_EVENT]) {
      unlistenSpy.mockClear();
      invokeCalls.length = 0;
      const { session, cb } = makeSession();
      const p = session.start();
      await settleListeners([failName]);
      await p;
      expect(cb.onStartFailed).toHaveBeenCalledTimes(1);
      expect(session.isRecording.value).toBe(false);
      expect(unlistenSpy).toHaveBeenCalledTimes(1); // 成功的那一個被回收
      expect(invokeCalls).not.toContain("start_hotkey_recording");
      expect(invokeCalls.filter((c) => c === "cancel_hotkey_recording")).toHaveLength(1);
      domPress("KeyK", "k");
      emitTauri(CAPTURED_EVENT, CAPTURED_K);
      expect(terminalCount(cb)).toBe(1);
    }
  });

  it("[P0] A 註冊失敗後開 B，A 的成功註冊才回來 → A 自卸、B 正常", async () => {
    const { session, cb } = makeSession();
    const pA = session.start();
    const [dCapturedA, dRejectedA] = listenDeferreds.splice(0, 2);
    dRejectedA.fail(new Error("late fail")); // A 的 rejected 註冊先失敗
    await Promise.resolve();
    // A 尚未終結（allSettled 還在等 captured），此時使用者 stop 再開 B
    session.stop();
    const pB = session.start();
    await settleListeners(); // B 的兩個註冊成功
    dCapturedA.ok(); // A 的 captured 註冊才成功 → 必自卸
    await pA;
    expect(unlistenSpy).toHaveBeenCalledWith(CAPTURED_EVENT);
    expect(cb.onStartFailed).not.toHaveBeenCalled(); // A 已被 stop，晚到的失敗不當終態
    expect(session.isRecording.value).toBe(true);
    startDeferred!.resolve();
    await pB;
    emitTauri(CAPTURED_EVENT, CAPTURED_K);
    expect(cb.onCaptured).toHaveBeenCalledTimes(1);
    expect(listeners.get(CAPTURED_EVENT)?.size ?? 0).toBe(0); // 只剩 B 的且已卸
  });

  it("[P0] captured 與 rejected 互競（兩種順序）→ 只一個終態", async () => {
    for (const order of ["captured-first", "rejected-first"]) {
      const { session, cb } = makeSession();
      await startAndArm(session);
      if (order === "captured-first") {
        emitTauri(CAPTURED_EVENT, CAPTURED_K);
        emitTauri(REJECTED_EVENT, ESC);
        expect(cb.onCaptured).toHaveBeenCalledTimes(1);
      } else {
        domPress("Escape", "Escape");
        emitTauri(CAPTURED_EVENT, CAPTURED_K);
        expect(cb.onRejected).toHaveBeenCalledTimes(1);
      }
      expect(terminalCount(cb)).toBe(1);
    }
  });

  it("[P0] 對活動中的 session 再 start → A 無終態、A 的 listener 卸掉、B 正常", async () => {
    const { session, cb } = makeSession();
    await startAndArm(session);
    await startAndArm(session); // B
    expect(terminalCount(cb)).toBe(0);
    expect(unlistenSpy).toHaveBeenCalledTimes(2);
    expect(listeners.get(CAPTURED_EVENT)?.size).toBe(1);
    vi.advanceTimersByTime(10_000);
    expect(cb.onTimeout).toHaveBeenCalledTimes(1);
  });

  it("[P0] 終態回呼入口：本地狀態、listener、timer 已清理", async () => {
    let seenInsideCallback: { recording: boolean; live: number } | null = null;
    const session = useHotkeyRecordingSession({
      enableDomSource: true,
      onCaptured: () => {
        seenInsideCallback = { recording: session.isRecording.value, live: listeners.get(CAPTURED_EVENT)?.size ?? 0 };
      },
      onRejected: vi.fn(),
      onTimeout: vi.fn(),
      onStartFailed: vi.fn(),
    });
    liveSessions.push(session);
    await startAndArm(session);
    domPress("KeyK", "k");
    expect(seenInsideCallback).toEqual({ recording: false, live: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("[P1] 和弦：右 Alt↓ 右 Ctrl↓ 全放開 → chordKeycodes 兩顆", async () => {
    const { session, cb } = makeSession();
    await startAndArm(session);
    domPress("AltRight", "Alt");
    domPress("ControlRight", "Control");
    domRelease("AltRight", "Alt");
    domRelease("ControlRight", "Control");
    expect(cb.onCaptured).toHaveBeenCalledWith({ keycode: 0xa3, modifiers: [], chordKeycodes: [0xa5, 0xa3] });
  });
});

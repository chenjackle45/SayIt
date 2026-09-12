// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDomHotkeyRecorder,
  createDomRecordingState,
  windowsVkFromKeyEvent,
  type DomRecordingResult,
} from "../../src/composables/useDomHotkeyRecorder";

// Windows VK（與 src/lib/keycodeMap.ts 的 DOM_CODE_TO_WINDOWS_VK_CODE 一致）
const VK = {
  A: 0x41,
  C: 0x43,
  K: 0x4b,
  Q: 0x51,
  ONE: 0x31,
  LSHIFT: 0xa0,
  LCONTROL: 0xa2,
  RCONTROL: 0xa3,
  LMENU: 0xa4,
  RMENU: 0xa5,
} as const;

/** 依序餵鍵序；「↓code[:key]」「↑code」 */
function drive(state: ReturnType<typeof createDomRecordingState>, seq: string[]) {
  const results: DomRecordingResult[] = [];
  for (const step of seq) {
    const dir = step[0];
    const rest = step.slice(1);
    if (dir === "↓") {
      const [code, key] = rest.split(":");
      results.push(state.onKeyDown(code, key ?? defaultKey(code)));
    } else {
      results.push(state.onKeyUp(rest));
    }
  }
  return results;
}

function defaultKey(code: string): string {
  const m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1].toLowerCase();
  const d = /^Digit([0-9])$/.exec(code);
  if (d) return d[1];
  return code;
}

function captured(results: DomRecordingResult[]) {
  return results.filter((r): r is Extract<DomRecordingResult, { kind: "captured" }> => r?.kind === "captured");
}

describe("windowsVkFromKeyEvent（gh-78：字母／數字跟配置走）", () => {
  it("[P0] QWERTY 與 AZERTY 都以 key 推 VK；Shift 大寫同碼", () => {
    expect(windowsVkFromKeyEvent("KeyC", "c")).toBe(VK.C);
    expect(windowsVkFromKeyEvent("KeyQ", "a")).toBe(VK.A); // AZERTY 的 Q 位置是 A
    expect(windowsVkFromKeyEvent("KeyQ", "A")).toBe(VK.A);
    expect(windowsVkFromKeyEvent("Digit1", "1")).toBe(VK.ONE);
  });

  it("[P0] 字母／數字位置但 key 不可定 → unresolvable（IME、AltGr、Dead、Shift+數字）", () => {
    expect(windowsVkFromKeyEvent("KeyQ", "Process")).toBe("unresolvable");
    expect(windowsVkFromKeyEvent("KeyQ", "@")).toBe("unresolvable");
    expect(windowsVkFromKeyEvent("KeyQ", "Dead")).toBe("unresolvable");
    expect(windowsVkFromKeyEvent("Digit1", "&")).toBe("unresolvable"); // AZERTY 數字列未 Shift
    expect(windowsVkFromKeyEvent("Digit2", "@")).toBe("unresolvable"); // QWERTY Shift+2
  });

  it("[P1] 其他位置沿用 code 表；表中沒有的鍵回 null", () => {
    expect(windowsVkFromKeyEvent("F5", "F5")).toBe(0x74);
    expect(windowsVkFromKeyEvent("ControlRight", "Control")).toBe(VK.RCONTROL);
    expect(windowsVkFromKeyEvent("F23", "F23")).toBeNull();
    expect(windowsVkFromKeyEvent("NumpadEnter", "Enter")).toBeNull();
  });
});

describe("createDomRecordingState（鏡像 Rust RecordingState）", () => {
  it("[P0] Ctrl↓ C↓ → Combo control+C", () => {
    const r = drive(createDomRecordingState(), ["↓ControlLeft", "↓KeyC"]);
    expect(captured(r)).toEqual([
      { kind: "captured", payload: { keycode: VK.C, modifiers: ["control"], chordKeycodes: [] } },
    ]);
  });

  it("[P0] 單右 Ctrl 按放 → 單鍵", () => {
    const r = drive(createDomRecordingState(), ["↓ControlRight", "↑ControlRight"]);
    expect(captured(r)).toEqual([
      { kind: "captured", payload: { keycode: VK.RCONTROL, modifiers: [], chordKeycodes: [] } },
    ]);
  });

  it("[P0] 右 Alt＋右 Ctrl 任意順序放開 → 和弦兩顆", () => {
    for (const release of [["↑AltRight", "↑ControlRight"], ["↑ControlRight", "↑AltRight"]]) {
      const r = drive(createDomRecordingState(), ["↓AltRight", "↓ControlRight", ...release]);
      expect(captured(r)).toEqual([
        {
          kind: "captured",
          payload: { keycode: VK.RCONTROL, modifiers: [], chordKeycodes: [VK.RMENU, VK.RCONTROL] },
        },
      ]);
    }
  });

  it("[P0] Ctrl↓ Alt↓ Ctrl↑ K↓ → 先放的不算，只有 option", () => {
    const r = drive(createDomRecordingState(), ["↓ControlLeft", "↓AltLeft", "↑ControlLeft", "↓KeyK"]);
    expect(captured(r)).toEqual([
      { kind: "captured", payload: { keycode: VK.K, modifiers: ["option"], chordKeycodes: [] } },
    ]);
  });

  it("[P0] Ctrl↓ Alt↓ Ctrl↑ Alt↑ → 和弦取自最後一次 down 的 snapshot（兩顆）", () => {
    const r = drive(createDomRecordingState(), ["↓ControlLeft", "↓AltLeft", "↑ControlLeft", "↑AltLeft"]);
    expect(captured(r)[0]?.payload.chordKeycodes).toEqual([VK.LCONTROL, VK.LMENU]);
  });

  it("[P1] 錄製前就按住的鍵放開 → 無輸出", () => {
    const r = drive(createDomRecordingState(), ["↑ControlLeft"]);
    expect(r).toEqual([null]);
  });

  it("[P1] 修飾鍵 autorepeat → 和弦成員不增、snapshot 不變", () => {
    const r = drive(createDomRecordingState(), [
      "↓AltRight", "↓AltRight", "↓AltRight", "↓ControlRight", "↓ControlRight", "↑AltRight", "↑ControlRight",
    ]);
    expect(captured(r)[0]?.payload.chordKeycodes).toEqual([VK.RMENU, VK.RCONTROL]);
  });

  it("[P1] 放 Ctrl 後再按放 Shift → 兩次各自單鍵", () => {
    const r = drive(createDomRecordingState(), ["↓ControlLeft", "↑ControlLeft", "↓ShiftLeft", "↑ShiftLeft"]);
    expect(captured(r).map((c) => c.payload.keycode)).toEqual([VK.LCONTROL, VK.LSHIFT]);
  });

  it("[P0] Escape → rejected esc_reserved", () => {
    const r = drive(createDomRecordingState(), ["↓Escape:Escape"]);
    expect(r).toEqual([{ kind: "rejected", payload: { reason: "esc_reserved" } }]);
  });

  it("[P1] 表中沒有的鍵（F23、NumpadEnter）→ 忽略、繼續錄", () => {
    const r = drive(createDomRecordingState(), ["↓ControlLeft", "↓F23:F23", "↓NumpadEnter:Enter", "↓KeyK"]);
    expect(r.slice(0, 3)).toEqual([null, null, null]);
    expect(captured(r)[0]?.payload).toEqual({ keycode: VK.K, modifiers: ["control"], chordKeycodes: [] });
  });

  it("[P0] 不可定鍵碼 → unresolvable 且狀態清空（之後放修飾鍵無輸出）", () => {
    for (const key of ["Process", "@", "Dead"]) {
      const r = drive(createDomRecordingState(), ["↓ControlLeft", `↓KeyQ:${key}`, "↑ControlLeft"]);
      expect(r).toEqual([null, { kind: "unresolvable" }, null]);
    }
    const shiftDigit = drive(createDomRecordingState(), ["↓ShiftLeft", "↓Digit2:@", "↑ShiftLeft"]);
    expect(shiftDigit).toEqual([null, { kind: "unresolvable" }, null]);
    const azertyDigit = drive(createDomRecordingState(), ["↓ControlLeft", "↓Digit1:&", "↑ControlLeft"]);
    expect(azertyDigit).toEqual([null, { kind: "unresolvable" }, null]);
  });
});

describe("createDomHotkeyRecorder（掛載層）", () => {
  const recorder = createDomHotkeyRecorder();
  let hasFocus = true;
  vi.spyOn(document, "hasFocus").mockImplementation(() => hasFocus);

  afterEach(() => {
    recorder.stop();
    hasFocus = true;
  });

  function press(code: string, key = defaultKey(code)) {
    const ev = new KeyboardEvent("keydown", { code, key, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    return ev;
  }
  function release(code: string) {
    window.dispatchEvent(new KeyboardEvent("keyup", { code, key: defaultKey(code), bubbles: true, cancelable: true }));
  }
  function arm() {
    const onCaptured = vi.fn();
    const onRejected = vi.fn();
    const armed = recorder.start({ onCaptured, onRejected });
    return { armed, onCaptured, onRejected };
  }

  it("[P0] 有焦點才掛；沒焦點 start 回 false 且不收事件", () => {
    hasFocus = false;
    const { armed, onCaptured } = arm();
    expect(armed).toBe(false);
    expect(recorder.isActive).toBe(false);
    press("KeyK");
    expect(onCaptured).not.toHaveBeenCalled();
  });

  it("[P0] 一般鍵 → onCaptured 一次、preventDefault、bubble 階段 listener 收不到", () => {
    const bubbleListener = vi.fn();
    window.addEventListener("keydown", bubbleListener);
    const { onCaptured } = arm();
    const ev = press("KeyK");
    expect(ev.defaultPrevented).toBe(true);
    expect(bubbleListener).not.toHaveBeenCalled();
    expect(onCaptured).toHaveBeenCalledTimes(1);
    expect(onCaptured.mock.calls[0][0]).toEqual({ keycode: VK.K, modifiers: [], chordKeycodes: [] });
    expect(recorder.isActive).toBe(false); // 抓到即停
    window.removeEventListener("keydown", bubbleListener);
  });

  it("[P0] Ctrl↓ blur K↓ → 無輸出（blur 後本輪停用，不自動恢復）", () => {
    const { onCaptured } = arm();
    press("ControlLeft", "Control");
    window.dispatchEvent(new Event("blur"));
    expect(recorder.isActive).toBe(false);
    press("KeyK");
    release("ControlLeft");
    expect(onCaptured).not.toHaveBeenCalled();
  });

  it("[P1] Ctrl↓ blur Ctrl↑ → 無輸出", () => {
    const { onCaptured } = arm();
    press("ControlLeft", "Control");
    window.dispatchEvent(new Event("blur"));
    release("ControlLeft");
    expect(onCaptured).not.toHaveBeenCalled();
  });

  it("[P0] 不可定鍵碼 → 本輪停用、無回呼", () => {
    const { onCaptured, onRejected } = arm();
    press("KeyQ", "Process");
    expect(recorder.isActive).toBe(false);
    expect(onCaptured).not.toHaveBeenCalled();
    expect(onRejected).not.toHaveBeenCalled();
  });

  it("[P1] Escape → onRejected esc_reserved", () => {
    const { onRejected } = arm();
    press("Escape", "Escape");
    expect(onRejected).toHaveBeenCalledWith({ reason: "esc_reserved" });
  });

  it("[P1] stop() 後再送鍵 → 無輸出", () => {
    const { onCaptured } = arm();
    recorder.stop();
    press("KeyK");
    expect(onCaptured).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import { getChordTriggerKeyDisplayName } from "../../src/lib/keycodeMap";
import {
  isChordTriggerKey,
  isComboTriggerKey,
  isCustomTriggerKey,
  isRecordedTriggerKey,
  type TriggerKey,
} from "../../src/types/settings";

// gh-30：純修飾鍵和弦（右 Alt＋右 Ctrl）— 顯示名依平台鍵碼表、左右分開

const originalUserAgent = navigator.userAgent;
function setUserAgent(ua: string) {
  Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
}

afterEach(() => {
  setUserAgent(originalUserAgent);
  vi.restoreAllMocks();
});

describe("ChordTriggerKey", () => {
  it("type guards distinguish chord from combo and custom", () => {
    const chord: TriggerKey = { chord: { keycodes: [0xa5, 0xa3] } };
    const combo: TriggerKey = { combo: { modifiers: ["control"], keycode: 0x4b } };
    const custom: TriggerKey = { custom: { keycode: 0x4b } };
    expect(isChordTriggerKey(chord)).toBe(true);
    expect(isComboTriggerKey(chord)).toBe(false);
    expect(isCustomTriggerKey(chord)).toBe(false);
    expect(isChordTriggerKey(combo)).toBe(false);
    expect(isRecordedTriggerKey(chord)).toBe(true);
    expect(isRecordedTriggerKey(custom)).toBe(true);
    expect(isRecordedTriggerKey("fn")).toBe(false);
  });

  it("displays Windows VK chord with left/right names", () => {
    setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    expect(getChordTriggerKeyDisplayName({ chord: { keycodes: [0xa5, 0xa3] } })).toBe(
      "Right Alt/Option+Right Control",
    );
  });

  it("displays macOS keycode chord with left/right names", () => {
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    expect(getChordTriggerKeyDisplayName({ chord: { keycodes: [61, 62] } })).toBe(
      "Right Alt/Option+Right Control",
    );
  });

  it("falls back to Key(n) for unknown keycodes without throwing", () => {
    setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    expect(getChordTriggerKeyDisplayName({ chord: { keycodes: [0xa5, 0xff] } })).toBe(
      "Right Alt/Option+Key(255)",
    );
  });
});

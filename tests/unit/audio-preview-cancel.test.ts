import { describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";

// 設定模式切走「麥克風」分頁時會 stopPreview；若這時有 startPreview 還在等 stop IPC，
// 它完成後不得把預覽重新打開（v0.16 #4 實作閘 HIGH）

let releaseStop: () => void = () => {};
const invokeMock = vi.fn((cmd: string) => {
  if (cmd === "stop_audio_preview") {
    return new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
  }
  return Promise.resolve();
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string) => invokeMock(cmd) }));
vi.mock("../../src/composables/useTauriEvents", () => ({
  AUDIO_PREVIEW_LEVEL: "audio:preview-level",
  listenToEvent: vi.fn().mockResolvedValue(() => {}),
}));

import { useAudioPreview } from "../../src/composables/useAudioPreview";

describe("useAudioPreview 取消", () => {
  it("startPreview 等待中呼叫 stopPreview → 不會送出 start_audio_preview", async () => {
    let preview!: ReturnType<typeof useAudioPreview>;
    const wrapper = mount(
      defineComponent({
        setup() {
          preview = useAudioPreview();
          return () => h("div");
        },
      }),
    );

    const pendingStart = preview.startPreview("MacBook");
    const firstRelease = releaseStop;
    void preview.stopPreview();
    const secondRelease = releaseStop;
    firstRelease();
    secondRelease();
    await pendingStart;
    await flushPromises();

    expect(invokeMock).not.toHaveBeenCalledWith("start_audio_preview");
    expect(preview.isPreviewActive.value).toBe(false);
    wrapper.unmount();
  });
});

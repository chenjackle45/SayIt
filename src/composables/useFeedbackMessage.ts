import { ref } from "vue";
import { toast } from "vue-sonner";

type FeedbackType = "success" | "error" | "";

const FEEDBACK_DISPLAY_DURATION_MS = 2500;

export function useFeedbackMessage() {
  const message = ref("");
  const type = ref<FeedbackType>("");
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer() {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  }

  // v0.16 #7：成功類改 toast（主視窗右下角）；錯誤維持在原位顯示，讓使用者看得到出錯的那一欄
  function show(feedbackType: "success" | "error", feedbackMessage: string) {
    clearTimer();
    if (feedbackType === "success") {
      message.value = "";
      type.value = "";
      toast.success(feedbackMessage);
      return;
    }
    type.value = feedbackType;
    message.value = feedbackMessage;
    timer = setTimeout(() => {
      message.value = "";
      type.value = "";
    }, FEEDBACK_DISPLAY_DURATION_MS);
  }

  return { message, type, show, clearTimer };
}

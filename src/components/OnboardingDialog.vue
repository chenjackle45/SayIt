<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { CheckCircle2, ExternalLink, Flag, Keyboard, KeyRound, Mic, ShieldCheck } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ConnectionTestButton from "./ConnectionTestButton.vue";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useAccessibilityPermission } from "@/composables/useAccessibilityPermission";
import { useHotkeyRecordingSession } from "@/composables/useHotkeyRecordingSession";
import { testWhisperConnection } from "@/lib/connectionTest";
import { extractErrorMessage } from "@/lib/errorUtils";
import { getDomCodeByKeycode } from "@/lib/keycodeMap";
import type { RecordingCapturedPayload } from "@/types/events";

const { t } = useI18n();
const settings = useSettingsStore();
const isMac = navigator.userAgent.includes("Mac");
const steps = isMac ? ["permission", "key", "hotkey", "try"] as const : ["key", "hotkey", "try"] as const;
const stepIndex = ref(0);
const step = computed(() => steps[stepIndex.value]);
const icons = { permission: ShieldCheck, key: KeyRound, hotkey: Keyboard, try: Mic };
const inputKey = ref(settings.getApiKey());
const savedTestedKey = ref(settings.getApiKey());
const isTesting = ref(false);
const error = ref("");
const finishing = ref(false);
const trialInput = ref<InstanceType<typeof Textarea> | null>(null);
let isActive = true;

const permission = useAccessibilityPermission(() => isMac && step.value === "permission");
const canAdvance = computed(() => {
  if (step.value === "permission") return permission.hasPermission.value;
  if (step.value === "key") return inputKey.value.trim() !== "" && savedTestedKey.value === inputKey.value.trim();
  return true;
});
const triggerKeyLabel = computed(() => {
  const key = settings.hotkeyConfig?.triggerKey;
  return key ? settings.getTriggerKeyDisplayName(key) : "";
});

async function testAndSaveKey() {
  const key = inputKey.value.trim();
  savedTestedKey.value = "";
  isTesting.value = true;
  try {
    const result = await testWhisperConnection(settings.selectedWhisperModelId, key);
    if (!result.ok || key !== inputKey.value.trim() || !isActive) return result;
    try {
      await settings.saveApiKey(key);
      savedTestedKey.value = key;
      return result;
    } catch (err) {
      return { ok: false as const, durationMs: result.durationMs, errorMessage: extractErrorMessage(err) };
    }
  } finally {
    isTesting.value = false;
  }
}

async function saveRecordedKey({ keycode, modifiers, chordKeycodes }: RecordingCapturedPayload) {
  const domCode = getDomCodeByKeycode(keycode) ?? "";
  try {
    if (chordKeycodes.length >= 2) {
      await settings.saveComboTriggerKey({ chord: { keycodes: chordKeycodes } }, domCode, settings.triggerMode);
    } else if (modifiers.length > 0) {
      await settings.saveComboTriggerKey({ combo: { modifiers, keycode } }, domCode, settings.triggerMode);
    } else {
      await settings.saveCustomTriggerKey(keycode, domCode, settings.triggerMode);
    }
  } catch (err) {
    error.value = extractErrorMessage(err);
  }
}
const recording = useHotkeyRecordingSession({
  enableDomSource: !isMac,
  onCaptured: (payload) => void saveRecordedKey(payload),
  onRejected: (payload) => {
    error.value = payload.reason === "esc_reserved"
      ? settings.getEscapeReservedMessage() : settings.getHotkeyUnsupportedKeyMessage();
  },
  onTimeout: () => { error.value = settings.getHotkeyRecordingTimeoutMessage(); },
  onStartFailed: (err) => { error.value = extractErrorMessage(err); },
});

watch(step, async (value, previous) => {
  if (previous === "hotkey") recording.stop();
  error.value = "";
  if (value === "try") {
    await nextTick();
    (trialInput.value?.$el as HTMLTextAreaElement | undefined)?.focus();
  }
});
onBeforeUnmount(() => {
  isActive = false;
  recording.stop();
});

async function finish() {
  recording.stop();
  finishing.value = true;
  try {
    await settings.completeOnboarding();
  } catch (err) {
    error.value = extractErrorMessage(err);
  } finally {
    finishing.value = false;
  }
}
function advance() {
  if (stepIndex.value === steps.length - 1) void finish();
  else stepIndex.value++;
}
</script>

<template>
  <Dialog :open="true" @update:open="(open) => { if (!open) void finish(); }">
    <DialogContent class="max-h-[calc(100vh-3rem)] overflow-y-auto rounded-2xl" :show-close-button="false">
      <DialogHeader>
        <div class="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Flag class="size-4" />
          {{ t("onboarding.title") }} · {{ stepIndex + 1 }}/{{ steps.length }}
        </div>
        <component :is="icons[step]" class="mb-2 size-8 text-primary" aria-hidden="true" />
        <DialogTitle>{{ t(`onboarding.${step}.title`) }}</DialogTitle>
        <DialogDescription>{{ t(`onboarding.${step}.description`) }}</DialogDescription>
      </DialogHeader>

      <div v-if="step === 'permission'" class="space-y-3" data-testid="onboarding-permission">
        <p v-if="permission.hasPermission.value" class="flex items-center gap-2 text-sm text-success"><CheckCircle2 class="size-4" />{{ t("onboarding.completed") }}</p>
        <Button v-else :disabled="permission.isReinitializing.value" @click="permission.openSettings">
          <ExternalLink class="size-4" />{{ t("accessibility.openSettings") }}
        </Button>
        <p v-if="permission.isReinitializing.value" class="text-sm text-muted-foreground">{{ t("accessibility.reinitializing") }}</p>
        <p v-if="permission.reinitializeError.value" role="alert" class="text-sm text-destructive">{{ permission.reinitializeError.value }}</p>
      </div>
      <div v-else-if="step === 'key'" class="space-y-3" data-testid="onboarding-key">
        <Label for="onboarding-api-key">{{ t("settings.apiKey.title") }}</Label>
        <Input id="onboarding-api-key" v-model="inputKey" type="password" autocomplete="off" />
        <ConnectionTestButton :key="inputKey" :on-test="testAndSaveKey" :disabled="!inputKey.trim() || isTesting" />
        <p v-if="canAdvance" class="flex items-center gap-2 text-sm text-success"><CheckCircle2 class="size-4" />{{ t("onboarding.completed") }}</p>
      </div>
      <div v-else-if="step === 'hotkey'" class="space-y-3" data-testid="onboarding-hotkey">
        <kbd class="inline-block rounded-lg border border-border bg-muted px-4 py-2 text-lg">{{ triggerKeyLabel }}</kbd>
        <p class="text-sm text-muted-foreground">{{ t(settings.triggerMode === 'hold' ? 'settings.hotkey.holdDescription' : 'settings.hotkey.toggleDescription') }}</p>
        <p v-if="recording.isRecording.value" class="text-sm text-muted-foreground">{{ t("settings.hotkey.releaseAllHint") }}</p>
        <Button variant="outline" :disabled="recording.isRecording.value" @click="error = ''; recording.start()">{{ t(recording.isRecording.value ? 'settings.hotkey.pressKey' : 'settings.hotkey.record') }}</Button>
      </div>
      <div v-else class="space-y-3" data-testid="onboarding-try">
        <p class="text-sm text-foreground">{{ t(settings.triggerMode === 'hold' ? 'onboarding.try.hold' : 'onboarding.try.toggle', { key: triggerKeyLabel }) }}</p>
        <Label for="onboarding-trial">{{ t("onboarding.try.input") }}</Label>
        <Textarea id="onboarding-trial" ref="trialInput" rows="3" />
      </div>
      <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
      <DialogFooter class="gap-2">
        <Button variant="ghost" data-testid="onboarding-skip" :disabled="finishing" @click="finish">{{ t("onboarding.skip") }}</Button>
        <Button v-if="stepIndex > 0" variant="outline" data-testid="onboarding-back" :disabled="finishing" @click="stepIndex--">{{ t("onboarding.back") }}</Button>
        <Button data-testid="onboarding-next" :disabled="!canAdvance || finishing" @click="advance">{{ t(step === 'try' ? 'onboarding.finish' : 'onboarding.next') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

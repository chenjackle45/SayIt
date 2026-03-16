<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useHallucinationStore } from "../stores/useHallucinationStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { extractErrorMessage } from "../lib/errorUtils";
import { useFeedbackMessage } from "../composables/useFeedbackMessage";
import { useI18n } from "vue-i18n";
import { Plus, Trash2, Info, Bot, Hand } from "lucide-vue-next";
import { captureError } from "../lib/sentry";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
const hallucinationStore = useHallucinationStore();
const settingsStore = useSettingsStore();
const { t, locale } = useI18n();

const newTermInput = ref("");
const isAdding = ref(false);
const removingTermIdSet = ref(new Set<string>());
const feedback = useFeedbackMessage();

const isAddDisabled = computed(
  () => !newTermInput.value.trim() || isAdding.value,
);

const showDuplicateHint = computed(
  () =>
    newTermInput.value.trim() !== "" &&
    hallucinationStore.isDuplicateTerm(newTermInput.value),
);

const autoTermList = computed(() =>
  hallucinationStore.termList.filter((entry) => entry.source === "auto"),
);

const manualTermList = computed(() =>
  hallucinationStore.termList.filter((entry) => entry.source === "manual"),
);

async function handleAddTerm() {
  const term = newTermInput.value.trim();
  if (!term) return;

  try {
    isAdding.value = true;
    const whisperCode = settingsStore.getWhisperLanguageCode() ?? "zh";
    await hallucinationStore.addTerm(term, "manual", whisperCode);
    newTermInput.value = "";
  } catch (err) {
    feedback.show("error", extractErrorMessage(err));
  } finally {
    isAdding.value = false;
  }
}

async function handleRemoveTerm(id: string) {
  if (removingTermIdSet.value.has(id)) return;

  try {
    removingTermIdSet.value.add(id);
    await hallucinationStore.removeTerm(id);
  } catch (err) {
    feedback.show("error", extractErrorMessage(err));
  } finally {
    removingTermIdSet.value.delete(id);
  }
}

function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString + "Z");
    return date.toLocaleDateString(locale.value, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return dateString;
  }
}

onMounted(async () => {
  try {
    await hallucinationStore.fetchTermList();
  } catch (err) {
    feedback.show("error", t("dictionary.loadFailed"));
    captureError(err, { source: "hallucination-view-mount" });
  }
});

onBeforeUnmount(() => {
  feedback.clearTimer();
});
</script>

<template>
  <div class="p-6">
    <!-- Page header -->
    <div class="flex flex-wrap items-center justify-between gap-4">
      <Badge variant="secondary">
        {{ $t("hallucination.totalCount", { count: hallucinationStore.termCount }) }}
      </Badge>

      <div class="flex items-center gap-2">
        <div class="flex flex-col">
          <Input
            v-model="newTermInput"
            :placeholder="$t('hallucination.addPlaceholder')"
            class="w-48"
            @keydown.enter="handleAddTerm"
          />
          <p v-if="showDuplicateHint" class="mt-1 text-xs text-destructive">
            {{ $t("hallucination.duplicateWarning") }}
          </p>
        </div>
        <Button
          size="sm"
          :disabled="isAddDisabled || showDuplicateHint"
          @click="handleAddTerm"
        >
          <Plus class="mr-1 h-4 w-4" />{{ $t("hallucination.addButton") }}
        </Button>
      </div>
    </div>

    <!-- Description -->
    <div class="mt-4 rounded-lg border border-border bg-muted/50 p-4">
      <div class="flex gap-3">
        <Info class="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <p class="text-sm text-muted-foreground">
          {{ $t("hallucination.description") }}
        </p>
      </div>
    </div>

    <!-- Feedback message -->
    <transition name="feedback-fade">
      <p
        v-if="feedback.message.value !== ''"
        class="mt-3 text-sm"
        :class="feedback.type.value === 'success' ? 'text-emerald-500' : 'text-destructive'"
      >
        {{ feedback.message.value }}
      </p>
    </transition>

    <!-- Loading state -->
    <div
      v-if="hallucinationStore.isLoading"
      class="mt-6 text-center text-muted-foreground"
    >
      {{ $t("dictionary.loading") }}
    </div>

    <!-- Empty state -->
    <div v-else-if="hallucinationStore.termCount === 0" class="mt-6">
      <Card>
        <div class="px-4 py-8 text-center text-muted-foreground">
          {{ $t("hallucination.emptyState") }}
        </div>
      </Card>
    </div>

    <!-- Term sections -->
    <div v-else class="mt-6 space-y-6">
      <!-- Manual Section -->
      <Card v-if="manualTermList.length > 0">
        <CardHeader class="pb-3">
          <div class="flex items-center gap-2">
            <CardTitle class="text-base">
              <Hand class="mr-1 inline h-4 w-4" />
              {{ $t("hallucination.sourceManual") }}
            </CardTitle>
            <Badge variant="secondary">{{ manualTermList.length }}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead class="w-full">{{ $t("hallucination.termHeader") }}</TableHead>
                <TableHead class="w-20 text-center">{{ $t("hallucination.localeHeader") }}</TableHead>
                <TableHead class="w-40">{{ $t("hallucination.dateHeader") }}</TableHead>
                <TableHead class="w-20 text-right">{{ $t("hallucination.actionHeader") }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="entry in manualTermList" :key="entry.id">
                <TableCell class="font-medium text-foreground">{{ entry.term }}</TableCell>
                <TableCell class="text-center text-muted-foreground">{{ entry.locale }}</TableCell>
                <TableCell class="text-muted-foreground">{{ formatDate(entry.createdAt) }}</TableCell>
                <TableCell class="text-right">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    class="text-destructive"
                    :disabled="removingTermIdSet.has(entry.id)"
                    @click="handleRemoveTerm(entry.id)"
                  >
                    <Trash2 class="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <!-- Auto-learned Section -->
      <Card v-if="autoTermList.length > 0">
        <CardHeader class="pb-3">
          <div class="flex items-center gap-2">
            <CardTitle class="text-base">
              <Bot class="mr-1 inline h-4 w-4" />
              {{ $t("hallucination.sourceAuto") }}
            </CardTitle>
            <Badge variant="secondary">{{ autoTermList.length }}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead class="w-full">{{ $t("hallucination.termHeader") }}</TableHead>
                <TableHead class="w-20 text-center">{{ $t("hallucination.localeHeader") }}</TableHead>
                <TableHead class="w-40">{{ $t("hallucination.dateHeader") }}</TableHead>
                <TableHead class="w-20 text-right">{{ $t("hallucination.actionHeader") }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="entry in autoTermList" :key="entry.id">
                <TableCell class="font-medium text-foreground">{{ entry.term }}</TableCell>
                <TableCell class="text-center text-muted-foreground">{{ entry.locale }}</TableCell>
                <TableCell class="text-muted-foreground">{{ formatDate(entry.createdAt) }}</TableCell>
                <TableCell class="text-right">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    class="text-destructive"
                    :disabled="removingTermIdSet.has(entry.id)"
                    @click="handleRemoveTerm(entry.id)"
                  >
                    <Trash2 class="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

    </div>
  </div>
</template>

<style scoped>
.feedback-fade-enter-active,
.feedback-fade-leave-active {
  transition: opacity 180ms ease;
}

.feedback-fade-enter-from,
.feedback-fade-leave-to {
  opacity: 0;
}
</style>

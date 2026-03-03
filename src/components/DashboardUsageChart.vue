<script setup lang="ts">
import type { DailyUsageTrend } from "@/types/transcription";
import type { ChartConfig } from "@/components/ui/chart";
import { VisArea, VisAxis, VisLine, VisXYContainer } from "@unovis/vue";
import {
  ChartContainer,
  ChartCrosshair,
  ChartTooltip,
  ChartTooltipContent,
  componentToString,
} from "@/components/ui/chart";

const props = defineProps<{ data: DailyUsageTrend[] }>();

const chartConfig = {
  count: { label: "使用次數", color: "var(--primary)" },
} satisfies ChartConfig;

const svgDefs = `
  <linearGradient id="fillCount" x1="0" y1="0" x2="0" y2="1">
    <stop offset="5%" stop-color="var(--color-count)" stop-opacity="0.8" />
    <stop offset="95%" stop-color="var(--color-count)" stop-opacity="0.1" />
  </linearGradient>
`;

const xAccessor = (d: DailyUsageTrend) => new Date(d.date);
const yAccessor = [(d: DailyUsageTrend) => d.count];
const fillColor = () => "url(#fillCount)";
const lineColor = () => chartConfig.count.color;

function formatDateLabel(d: number): string {
  const date = new Date(d);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}/${day}`;
}
</script>

<template>
  <div class="rounded-xl border border-zinc-700 bg-zinc-900 p-5">
    <div class="mb-4">
      <h2 class="text-lg font-semibold text-white">每日使用趨勢</h2>
      <p class="text-sm text-zinc-400">最近 30 天</p>
    </div>

    <div v-if="props.data.length === 0" class="rounded-lg border border-dashed border-zinc-600 px-4 py-8 text-center text-zinc-400">
      尚無使用記錄
    </div>

    <ChartContainer v-else :config="chartConfig" class="aspect-auto h-[200px] w-full" :cursor="false">
      <VisXYContainer
        :data="props.data"
        :svg-defs="svgDefs"
        :margin="{ left: -40 }"
      >
        <VisArea
          :x="xAccessor"
          :y="yAccessor"
          :color="fillColor"
          :opacity="0.6"
        />
        <VisLine
          :x="xAccessor"
          :y="yAccessor"
          :color="lineColor"
          :line-width="1.5"
        />
        <VisAxis
          type="x"
          :x="xAccessor"
          :tick-line="false"
          :domain-line="false"
          :grid-line="false"
          :num-ticks="6"
          :tick-format="formatDateLabel"
        />
        <VisAxis
          type="y"
          :num-ticks="3"
          :tick-line="false"
          :domain-line="false"
        />
        <ChartTooltip />
        <ChartCrosshair
          :template="componentToString(chartConfig, ChartTooltipContent, {
            labelFormatter: (d) => formatDateLabel(d as number),
          })"
          :color="() => chartConfig.count.color"
        />
      </VisXYContainer>
    </ChartContainer>
  </div>
</template>

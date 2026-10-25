<script setup lang="ts">
import { computed } from 'vue'

/**
 * 拖动条 + 数值输入的行式控件。
 *
 * 左拖动条右数值框、两者双向联动:滑杆适合粗调,数值框适合精确输入。
 * 面板里所有可调数值(位置/大小/字号/中缝)统一用它,避免各处再写一套。
 */
const props = withDefaults(defineProps<{
  /** 当前值 */
  modelValue: number
  min: number
  max: number
  step?: number
  /** 左侧标签 */
  label: string
  /** 数值后缀,如 px / % */
  suffix?: string
  /** 无障碍名称;缺省用 label */
  ariaLabel?: string
}>(), {
  step: 1,
  suffix: '',
  ariaLabel: '',
})

const emit = defineEmits<{
  (e: 'update:modelValue', v: number): void
}>()

const clamped = computed(() => Math.min(props.max, Math.max(props.min, props.modelValue)))

/** 滑杆填充比例(WebKit 用 --fill 画已选段) */
const fill = computed(() => {
  const span = props.max - props.min
  return span > 0 ? ((clamped.value - props.min) / span) * 100 : 0
})

function commit(raw: number) {
  if (!Number.isFinite(raw)) return
  const clamped = Math.min(props.max, Math.max(props.min, raw))
  // 吸附到步长：拖动时由 range 的 step 保证,手动输入的值也要落到同一批刻度上,
  // 否则面板里会出现 47.3 这种既不好读、又与拖动结果对不齐的数
  const step = props.step > 0 ? props.step : 1
  const snapped = Number((Math.round(clamped / step) * step).toFixed(6))
  emit('update:modelValue', Math.min(props.max, Math.max(props.min, snapped)))
}

function onSlider(ev: Event) {
  commit(Number((ev.target as HTMLInputElement).value))
}

function onNumber(ev: Event) {
  commit(Number((ev.target as HTMLInputElement).value))
}
</script>

<template>
  <div class="slider-field">
    <!-- 名称必须可见:一排滑杆没有标签时无法分辨各自控制什么(实机反馈) -->
    <span class="sf-label">{{ label }}</span>
    <input
      class="slider"
      type="range"
      :min="min"
      :max="max"
      :step="step"
      :style="{ '--fill': `${fill}%` }"
      :value="clamped"
      :aria-label="ariaLabel || label"
      @input="onSlider"
    />
    <label class="num">
      <input
        class="sd-field"
        type="number"
        :min="min"
        :max="max"
        :step="step"
        :value="clamped"
        :aria-label="`${ariaLabel || label}(数值)`"
        @change="onNumber"
      />
      <span v-if="suffix" class="suffix">{{ suffix }}</span>
    </label>
  </div>
</template>

<style scoped>
.slider-field {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sf-label {
  flex: 0 0 46px;
  font-size: var(--sd-fs-xs);
  color: var(--sd-text-2);
  white-space: nowrap;
}

.slider {
  flex: 1;
  min-width: 0;
}

.num {
  display: flex;
  align-items: center;
  gap: 3px;
  flex: 0 0 auto;
}

.num input {
  width: 58px;
  padding: 6px 8px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.suffix {
  font-size: var(--sd-fs-xs);
  color: var(--sd-text-2);
}
</style>
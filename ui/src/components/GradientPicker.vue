<script setup lang="ts">
import { computed, ref } from 'vue'
import { PRESETS } from '../lib/presets'
import { parseCssGradient } from '../lib/cssGradient'
import type { CoverState } from '../lib/types'

const props = defineProps<{ modelValue: CoverState }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: CoverState): void }>()

const groups = computed(() => [...new Set(PRESETS.map((p) => p.group))])
const byGroup = (g: string) => PRESETS.filter((p) => p.group === g)
const cssOf = (g: { angle: number; stops: { offset: number; color: string }[] }) =>
  `linear-gradient(${g.angle}deg, ${g.stops.map((s) => `${s.color} ${s.offset}%`).join(', ')})`

/**
 * 最近使用(A1):独立 localStorage 键,不进 CoverState 存档——
 * 它是界面加速器而非封面数据,不参与存档校验与导出。
 */
const RECENT_KEY = 'halo-plugin-cover-generator/recent-presets/v1'
const RECENT_MAX = 4

function loadRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    const valid = raw.filter(
      (id): id is string => typeof id === 'string' && PRESETS.some((p) => p.id === id),
    )
    return valid.slice(0, RECENT_MAX)
  } catch {
    return []
  }
}
const recentIds = ref<string[]>(loadRecent())
const recentPresets = computed(() =>
  recentIds.value
    .map((id) => PRESETS.find((p) => p.id === id))
    .filter((p): p is (typeof PRESETS)[number] => !!p),
)
function pushRecent(id: string) {
  recentIds.value = [id, ...recentIds.value.filter((x) => x !== id)].slice(0, RECENT_MAX)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentIds.value))
  } catch {
    /* 存储不可用(隐私模式/超配额)时最近使用退化为会话内记忆,不影响主流程 */
  }
}

/** 当前样式名:选中预设显名,自定义显角度(渐变条右侧,状态一眼可读) */
const stripName = computed(() => {
  const preset = PRESETS.find((p) => p.id === props.modelValue.presetId)
  return preset ? preset.name : `自定义 · ${props.modelValue.gradient.angle}°`
})

function applyPreset(id: string) {
  const p = PRESETS.find((x) => x.id === id)!
  pushRecent(id)
  emit('update:modelValue', {
    ...props.modelValue,
    gradient: { angle: p.angle, stops: p.stops },
    presetId: id,
  })
}

/** 随机换色:等概率命中一个 ≠ 当前的预设,并走预设点击同款代码路径 */
function applyRandom() {
  const pool = PRESETS.filter((p) => p.id !== props.modelValue.presetId)
  const picked = pool[Math.floor(Math.random() * pool.length)]
  if (picked) applyPreset(picked.id)
}
// 自定义编辑:整体 emit 新状态(不原地 mutate prop),并清除预设选中态
function editGradient(patch: Partial<CoverState['gradient']>) {
  emit('update:modelValue', {
    ...props.modelValue,
    gradient: { ...props.modelValue.gradient, ...patch },
    presetId: null,
  })
}
const setStart = (c: string) =>
  editGradient({ stops: [{ offset: 0, color: c }, ...props.modelValue.gradient.stops.slice(1)] })
// 空 stops(不可信存档经 normalize 修复前不再出现,防御层):与 setStart 对称构造,不再写 [-1] 无操作(评审#2)
const setEnd = (c: string) => {
  const stops = [...props.modelValue.gradient.stops]
  if (stops.length === 0) {
    editGradient({ stops: [{ offset: 0, color: c }, { offset: 100, color: c }] })
    return
  }
  stops[stops.length - 1] = { offset: 100, color: c }
  editGradient({ stops })
}
const setAngle = (a: number) => editGradient({ angle: a })
// 角度周期归一到 0-360:数字框可键入任意值;mod 360 保持视觉等价
// (与 useCoverState.normalize 同一收敛口径,评审M2)
const onAngleInput = (e: Event) => {
  const v = Number((e.target as HTMLInputElement).value) || 0
  setAngle(((v % 360) + 360) % 360)
}

/** 粘贴 CSS 渐变(评审 A1 收纳):解析逻辑原样复用 lib/cssGradient */
const cssInput = ref('')
const cssError = ref('')
function applyCssGradient() {
  // 空输入静默返回:与「应用」按钮禁用态同语义,Enter 路径不得报错(评审M11)
  if (!cssInput.value.trim()) return
  const r = parseCssGradient(cssInput.value)
  if (!r.ok) {
    cssError.value = r.error
    return
  }
  emit('update:modelValue', {
    ...props.modelValue,
    gradient: r.gradient,
    presetId: null,
  })
  cssError.value = ''
}
</script>

<template>
  <section class="card">
    <div class="lb">
      <b>渐变</b>
      <span class="lb-right">
        <span class="meta">24 套预设</span>
        <button type="button" class="random-btn" title="随机换一个预设" @click="applyRandom">随机</button>
      </span>
    </div>

    <!-- 当前渐变条:不看右侧预览也能确认选中状态(A1) -->
    <div class="gstrip" :style="{ background: cssOf(modelValue.gradient) }">
      <span>{{ stripName }}</span>
    </div>

      <div v-if="recentPresets.length" class="group recent">
        <h4>最近使用</h4>
        <div class="swatches">
          <button
            v-for="p in recentPresets"
            :key="p.id"
            type="button"
            class="swatch"
            :class="{ active: modelValue.presetId === p.id }"
            :aria-pressed="modelValue.presetId === p.id"
            :style="{ background: cssOf(p) }"
            :title="`${p.name} ${p.stops.map((s) => s.color).join('→')}`"
            :aria-label="p.name"
            @click="applyPreset(p.id)"
          ></button>
        </div>
      </div>

    <details class="disc">
      <summary>
        <svg class="chev" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M3 1.5 6.5 5 3 8.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        全部预设
      </summary>
      <div class="disc-body">
        <div v-for="g in groups" :key="g" class="group">
          <h4>{{ g }}</h4>
          <div class="swatches">
            <button
              v-for="p in byGroup(g)"
              :key="p.id"
              type="button"
              class="swatch"
              :class="{ active: modelValue.presetId === p.id }"
              :aria-pressed="modelValue.presetId === p.id"
              :style="{ background: cssOf(p) }"
              :title="`${p.name} ${p.stops.map((s) => s.color).join('→')}`"
              :aria-label="p.name"
              @click="applyPreset(p.id)"
            ></button>
          </div>
        </div>
      </div>
    </details>

    <details class="disc">
      <summary>
        <svg class="chev" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M3 1.5 6.5 5 3 8.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        自定义 / 粘贴 CSS
      </summary>
      <div class="disc-body">
        <div class="custom">
          <label
            >起
            <input
              type="color"
              :value="modelValue.gradient.stops[0]?.color"
              @input="setStart(($event.target as HTMLInputElement).value)"
          /></label>
          <label
            >止
            <input
              type="color"
              :value="modelValue.gradient.stops.at(-1)?.color"
              @input="setEnd(($event.target as HTMLInputElement).value)"
          /></label>
          <label
            >角度
            <input
              type="number"
              min="0"
              max="360"
              :value="modelValue.gradient.angle"
              @input="onAngleInput"
          /></label>
        </div>
        <div class="row2 css-row">
          <input
            v-model="cssInput"
            class="sd-field sd-field--mono"
            placeholder="linear-gradient(45deg, #ff9a9e 0%, #fad0c4 100%)"
            aria-label="粘贴 CSS 渐变"
            @keydown.enter="applyCssGradient"
          />
          <button type="button" class="sd-btn-quiet" :disabled="!cssInput.trim()" @click="applyCssGradient">
            应用
          </button>
        </div>
        <p v-if="cssError" class="error">{{ cssError }}</p>
      </div>
    </details>
  </section>
</template>

<style scoped>
/* 与 ControlPanel 的分组卡同规格(内芯材质) */
.card {
  background: var(--sd-surface-card);
  border-radius: var(--sd-r-card);
  border: 1px solid var(--sd-edge-hairline);
  box-shadow: var(--sd-shadow-card);
  padding: var(--pit-sp-4);
  animation: sd-rise var(--sd-dur-enter) var(--sd-ease) var(--sd-delay-2) both;
}
.lb {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: var(--pit-sp-2);
}
.lb b {
  font-size: var(--sd-fs-md);
  font-weight: 600;
  letter-spacing: -0.01em;
}
.meta {
  font-size: var(--sd-fs-xs);
  color: var(--sd-text-2);
  font-variant-numeric: tabular-nums;
}
.lb-right {
  display: inline-flex;
  align-items: center;
  gap: var(--pit-sp-2);
}
/* 随机按钮:命中区高 ≥24px(D2) */
.random-btn {
  border: none;
  border-radius: var(--sd-r-pill);
  background: var(--sd-surface-raised);
  box-shadow: 0 0 0 1px var(--sd-line) inset;
  color: var(--sd-text);
  font-size: var(--sd-fs-xs);
  font-weight: 600;
  font-family: var(--sd-font);
  padding: 6px 12px;
  cursor: pointer;
  transition:
    background var(--sd-dur-hover) var(--sd-ease),
    transform var(--sd-dur-press) ease-out;
}
.random-btn:hover {
  background: var(--sd-surface-hover);
}
.random-btn:active {
  transform: scale(0.95);
}
.random-btn:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 3.5px var(--sd-focus-ring),
    0 0 0 1px var(--sd-focus-border);
}

/* 当前渐变条 */
.gstrip {
  height: 24px;
  border-radius: var(--sd-r-small);
  box-shadow: 0 0 0 1px var(--sd-line) inset;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 var(--pit-sp-2);
  margin-bottom: var(--pit-sp-2);
}
.gstrip span {
  font-size: var(--sd-fs-xs);
  color: var(--sd-text-on-accent);
  text-shadow: 0 1px 3px rgb(0 0 0 / 35%);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.group {
  margin-top: var(--pit-sp-3);
}
.group.recent {
  margin-top: var(--pit-sp-2);
}
h4 {
  margin: 0 0 var(--pit-sp-2);
  font-size: var(--sd-fs-xs);
  color: var(--sd-text-2);
  font-weight: 600;
  letter-spacing: 0.02em;
}
/* 一行 6 枚(A1 压缩):7px→8px 对齐间距尺度 */
.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: var(--pit-sp-2);
}
.swatch {
  width: calc((100% - 5 * var(--pit-sp-2)) / 6);
  min-width: 40px;
  height: 28px;
  border-radius: var(--sd-r-small);
  border: none;
  cursor: pointer;
  padding: 0;
  box-shadow: 0 0 0 1px var(--sd-line) inset;
  transition:
    transform var(--sd-dur-move) var(--sd-ease),
    box-shadow var(--sd-dur-move) var(--sd-ease);
}
.swatch:hover {
  transform: scale(1.06);
  box-shadow: var(--sd-shadow-swatch);
}
.swatch:active {
  transform: scale(0.95);
}
.swatch:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 3.5px var(--sd-focus-ring),
    0 0 0 1px var(--sd-focus-border);
}
.swatch.active {
  box-shadow:
    0 0 0 2.5px var(--sd-surface-thumb),
    0 0 0 4.5px var(--sd-accent);
}

/* 折叠区(A1):预设全集与自定义/CSS 收纳为渐进披露 */
.disc {
  border-top: 1px solid var(--sd-line);
  margin-top: var(--pit-sp-3);
  padding-top: var(--pit-sp-2);
}
.disc summary {
  list-style: none;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--sd-fs-sm);
  font-weight: 600;
  font-family: var(--sd-font);
  color: var(--sd-text-2);
  cursor: pointer;
  padding: 4px 2px;
  border-radius: var(--sd-r-small);
  min-height: 24px;
  box-sizing: border-box;
  user-select: none;
  transition: color var(--sd-dur-hover) var(--sd-ease);
}
.disc summary::-webkit-details-marker {
  display: none;
}
.disc summary:hover {
  color: var(--sd-text);
}
.disc summary:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3.5px var(--sd-focus-ring);
}
.chev {
  transition: transform var(--sd-dur-move) var(--sd-ease);
  display: inline-flex;
  flex: 0 0 auto;
}
.disc[open] summary .chev {
  transform: rotate(90deg);
}
.disc-body {
  padding-top: var(--pit-sp-2);
}

.custom {
  display: flex;
  gap: var(--pit-sp-3);
  align-items: center;
  flex-wrap: wrap;
  font-size: var(--sd-fs-md);
  color: var(--sd-text-2);
}
.custom label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.custom input[type='color'] {
  width: 40px;
  height: 28px;
  padding: 2px;
  border: none;
  border-radius: var(--sd-r-small);
  background: var(--sd-surface-control);
  box-shadow: 0 0 0 1px var(--sd-line) inset;
  cursor: pointer;
}
.custom input[type='number'] {
  width: 62px;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: var(--sd-r-small);
  background: var(--sd-surface-control);
  color: var(--sd-text);
  font-family: var(--sd-font-mono);
  font-variant-numeric: tabular-nums;
  box-shadow: 0 0 0 1px var(--sd-line) inset;
}
.custom input[type='number']:focus {
  outline: none;
  border-color: var(--sd-focus-border);
  box-shadow: 0 0 0 3.5px var(--sd-focus-ring);
}
.css-row {
  margin-top: var(--pit-sp-2);
}
/* 字段外壳走共享类 sd-field;此处补齐与其它行一致的占满行为 */
.css-row input {
  flex: 1;
  min-width: 0;
}
.error {
  color: var(--sd-danger-text);
  font-size: var(--sd-fs-sm);
  line-height: 1.5;
  margin: var(--pit-sp-2) 0 0;
}
</style>

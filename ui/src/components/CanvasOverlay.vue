<script setup lang="ts">
import { computed } from 'vue'
import type { CoverState } from '../lib/types'
import type { SelectionId } from '../composables/useCanvasInteraction'
import { builtinBoxes, customBoxes, type ElementBox } from '../lib/elementGeometry'
import { createMeasure, makeCtx, type FontLike } from '../lib/svgBuilder'

/**
 * 预览画布上的选中指示层。
 *
 * 只显示、不接收点击：元素的选择统一由「元素」面板完成（用户裁定），
 * 这样误点封面不会改变选中态，画布也保持纯预览。
 * 框体几何来自 elementGeometry，与渲染共用同一套度量，因此贴合图元实际大小。
 */
const props = defineProps<{
  state: CoverState
  selected: SelectionId | null
  font: FontLike | null
  /** 内置默认 Logo 是否可用（决定 Logo 命中框是否出现） */
  hasLogo: boolean
}>()

const ctx = computed(() => makeCtx(props.state.canvas))
const measure = computed(() => createMeasure(props.font))

const boxes = computed<ElementBox[]>(() => [
  ...builtinBoxes(props.state, measure.value, ctx.value, props.hasLogo),
  ...customBoxes(props.state.customElements, measure.value, ctx.value),
])

const pct = (n: number, total: number) => `${(n / total) * 100}%`

/** 选中框样式：旋转的文字要让框绕同一个锚点转，否则框与字会错开 */
function ringStyle(box: ElementBox): Record<string, string> {
  const w = box.width + PAD * 2
  const h = box.height + PAD * 2
  const style: Record<string, string> = {
    left: pct(box.x - PAD, ctx.value.W),
    top: pct(box.y - PAD, ctx.value.H),
    width: pct(w, ctx.value.W),
    height: pct(h, ctx.value.H),
  }
  if (box.rotation && box.pivot) {
    style.transform = `rotate(${box.rotation}deg)`
    style.transformOrigin =
      `${pct(box.pivot.x - (box.x - PAD), w)} ${pct(box.pivot.y - (box.y - PAD), h)}`
  }
  return style
}

/** 选中框略微外扩，避免与文字笔画完全重合而看不清边界 */
const PAD = 6
</script>

<template>
  <div class="ov" aria-hidden="true">
    <template v-for="box in boxes" :key="`${box.id}-${box.label}`">
      <div
        v-if="selected === box.id"
        class="ring"
        :style="ringStyle(box)"
      >
        <span class="tag">{{ box.label }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ov {
  position: absolute;
  inset: 0;
  /* 纯指示层：不拦截任何指针事件，画布保持只读预览 */
  pointer-events: none;
}

.ring {
  position: absolute;
  border: 1.5px solid var(--sd-accent-strong);
  border-radius: 6px;
  box-shadow: 0 0 0 3px var(--sd-focus-ring);
  transition:
    left var(--sd-dur-move) var(--sd-ease),
    top var(--sd-dur-move) var(--sd-ease),
    width var(--sd-dur-move) var(--sd-ease),
    height var(--sd-dur-move) var(--sd-ease);
}

.tag {
  position: absolute;
  top: -11px;
  left: -1.5px;
  padding: 1px 6px;
  font-size: var(--sd-fs-xs);
  line-height: 1.5;
  color: var(--sd-text-on-accent);
  background: var(--sd-accent-strong);
  border-radius: var(--sd-r-pill);
  white-space: nowrap;
}
</style>
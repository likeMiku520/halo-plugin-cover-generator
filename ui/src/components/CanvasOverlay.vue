<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Anchor, CoverState } from '../lib/types'
import {
  anchorOfTargets, hitTest, useCanvasDrag,
  type AnchorPatch, type CanvasPoint, type SelectionId,
} from '../composables/useCanvasInteraction'
import { builtinBoxes, customBoxes, type ElementBox } from '../lib/elementGeometry'
import { createMeasure, makeCtx, type FontLike } from '../lib/svgBuilder'
import type { Guide } from '../lib/smartGuides'

/**
 * 预览画布上的交互层：选中指示、拖动改位置、滚轮改大小、智能参考线。
 *
 * 命中判定用 elementGeometry 的包围盒（与渲染共用同一套度量），
 * 指针位置换算成画布比例后与锚点同坐标，因此预览缩放多少都不影响手感。
 * 写回状态一律走 emit，由工作台经既有更新路径落盘——画布不持有一份自己的状态。
 */
const props = withDefaults(defineProps<{
  state: CoverState
  selected: SelectionId | null
  font: FontLike | null
  /** 内置默认 Logo 是否可用（决定 Logo 命中框是否出现） */
  hasLogo: boolean
  /** 智能参考线：默认关闭，不请自来的吸附会打乱已有手感 */
  guides?: boolean
}>(), { guides: false })

const emit = defineEmits<{
  (e: 'select', id: SelectionId): void
  (e: 'anchor', id: SelectionId, patch: AnchorPatch): void
  /** 画布交互（拖动/滚轮）开始与结束：工作台据此让预览跟手 */
  (e: 'interacting', on: boolean): void
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

/**
 * 参考线配色：主题青 #39C5BB（与 tokens.css 的 --sd-accent 同源），半透明细线。
 * 写进内联样式而不是只放 CSS：线是动态生成的，颜色与位置必须来自同一处。
 */
const GUIDE_COLOR = 'rgba(57, 197, 187, 0.85)'

function guideStyle(g: Guide): Record<string, string> {
  const base = { background: GUIDE_COLOR }
  return g.axis === 'x'
    ? { ...base, left: pct(g.position, 1), top: '0', bottom: '0', width: '1px' }
    : { ...base, top: pct(g.position, 1), left: '0', right: '0', height: '1px' }
}

const root = ref<HTMLElement>()
const {
  guides: activeGuides, dragging, interacting, begin, move, end, scaleByWheel, markWheelActivity,
} = useCanvasDrag()

/**
 * 交互开始/结束抛给工作台：交互期间预览必须跟手（旁路 G1 的合帧防抖），
 * 否则用户拖动时看到的是「框走了、字还在原地」。
 *
 * 必须同步传播：滚轮是一次事件里「开窗口 + 写状态」两件事连着做，
 * 若等下一拍再告诉工作台，这第一批写入仍会按防抖处理，第一格滚动就要滞后 150ms。
 */
watch(interacting, (on) => emit('interacting', on), { flush: 'sync' })

/** 取某目标的当前锚点：与键盘微调、写回共用同一个取值函数 */
function anchorOf(id: SelectionId): Anchor | null {
  return anchorOfTargets(props.state, id)
}

/**
 * 指针位置 → 画布比例。
 * 交互层与 SVG 同尺寸（都铺满预览框），所以直接除以自身矩形即可，
 * 不需要知道预览被缩放到多少（画布分辨率与显示尺寸可以完全不同）。
 */
function pointOf(ev: PointerEvent): CanvasPoint | null {
  const rect = root.value?.getBoundingClientRect()
  if (!rect || !rect.width || !rect.height) return null
  return { x: (ev.clientX - rect.left) / rect.width, y: (ev.clientY - rect.top) / rect.height }
}

function onPointerDown(ev: PointerEvent) {
  const point = pointOf(ev)
  if (!point) return
  const hit = hitTest({
    boxes: boxes.value, point, canvas: props.state.canvas, layers: props.state.layers,
  })
  if (!hit) return // 空白处：不改选中，也不进入拖动
  const anchor = anchorOf(hit)
  const box = boxes.value.find((b) => b.id === hit)
  if (!anchor || !box) return
  // 未选中的元素先选中再拖：一次手势完成「选中 + 移动」，不必先回面板点一下
  if (hit !== props.selected) emit('select', hit)
  begin({ id: hit, anchor, box, point })
  ev.preventDefault() // 拖动期间不要顺带选中页面文字
  // 指针移出画布仍要跟随：捕获后事件继续回到本层；不支持的实现忽略即可
  const el = root.value
  if (el && typeof el.setPointerCapture === 'function') {
    try {
      el.setPointerCapture(ev.pointerId)
    } catch {
      // 指针已被释放（快速抬起）时抛错是正常的，不影响本次拖动
    }
  }
}

function onPointerMove(ev: PointerEvent) {
  if (!dragging.value) return
  const point = pointOf(ev)
  if (!point) return
  const next = move(point, {
    canvas: props.state.canvas, boxes: boxes.value, snap: props.guides,
  })
  if (!next) return
  emit('anchor', next.id, { x: next.x, y: next.y })
}

function onPointerEnd() {
  end()
}

function onWheel(ev: WheelEvent) {
  const id = props.selected
  // 未选中元素时完全不介入（页面照常滚动）；横向滚动也不接管
  if (!id || ev.deltaY === 0) return
  const current = anchorOf(id)
  if (!current) return
  const scale = scaleByWheel(ev, id, current.scale)
  // 选中即接管纵向滚轮：不足 1% 的零头也要拦下，否则页面会跟着一起滚
  ev.preventDefault()
  // 滚轮也是一次交互：窗口内预览跟手，滚完自动恢复防抖
  markWheelActivity()
  if (scale === null) return
  emit('anchor', id, { scale })
}
</script>

<template>
  <div
    ref="root"
    class="ov"
    :class="{ 'is-dragging': dragging }"
    aria-hidden="true"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerEnd"
    @pointercancel="onPointerEnd"
    @wheel="onWheel"
  >
    <template v-for="box in boxes" :key="`${box.id}-${box.label}`">
      <div
        v-if="selected === box.id"
        class="ring"
        :style="ringStyle(box)"
      >
        <span class="tag">{{ box.label }}</span>
      </div>
    </template>

    <div v-if="guides" class="guides">
      <div
        v-for="g in activeGuides"
        :key="g.axis"
        class="guide"
        :class="`guide-${g.axis}`"
        :style="guideStyle(g)"
      ></div>
    </div>
  </div>
</template>

<style scoped>
.ov {
  position: absolute;
  inset: 0;
  /* 交互层：拖动与滚轮都落在这里。「点空白处不拖」由命中测试决定，
   * 而不是靠 pointer-events 放行——否则元素自己也收不到按下事件 */
  pointer-events: auto;
  /* 元素跟手即可，不要出现文本选择光标 */
  user-select: none;
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

/* 拖动中关掉过渡：选中框若还在做位移补间，会明显落后于跟手的图元 */
.ov.is-dragging .ring {
  transition: none;
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

/* 参考线层：纯指示，不参与命中 */
.guides {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.guide {
  position: absolute;
}
</style>
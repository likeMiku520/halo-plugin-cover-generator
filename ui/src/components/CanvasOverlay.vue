<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Anchor, CoverState } from '../lib/types'
import {
  anchorOfTargets, canDeleteSelection, hitTest, useCanvasDrag,
  type AnchorPatch, type CanvasPoint, type SelectionId,
} from '../composables/useCanvasInteraction'
import { builtinBoxes, customBoxes, type ElementBox } from '../lib/elementGeometry'
import { createMeasure, makeCtx, type FontLike } from '../lib/svgBuilder'
import type { Guide } from '../lib/smartGuides'

/**
 * 预览画布上的交互层：选中指示与手柄、拖动改位置、滚轮改大小、旋转、删除、智能参考线。
 *
 * 命中判定用 elementGeometry 的包围盒（与渲染共用同一套度量），
 * 指针位置换算成画布比例后与锚点同坐标，因此预览缩放多少都不影响手感。
 * 写回状态一律走 emit，由工作台经既有更新路径落盘——画布不持有一份自己的状态。
 *
 * 本层不再整体 aria-hidden：框角上的手柄是真实控件，必须能被辅助技术找到；
 * 纯装饰的部分（标签文字、参考线）各自标 aria-hidden。
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
  /** 选中变化：命中元素传其 id，点空白区域传 null（取消选中） */
  (e: 'select', id: SelectionId | null): void
  (e: 'anchor', id: SelectionId, patch: AnchorPatch): void
  /** 画布交互（拖动/旋转/滚轮）开始与结束：工作台据此让预览跟手 */
  (e: 'interacting', on: boolean): void
  /** 点选中框上的 ×：具体动作由 deleteSelection 决定，画布不做策略 */
  (e: 'delete', id: SelectionId): void
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
  guides: activeGuides, dragging, rotating, scaling, interacting,
  begin, move, beginRotate, rotateTo, beginScale, scaleTo, end, scaleByWheel, markWheelActivity,
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
  if (!hit) {
    // 空白处：取消选中（标题不可删除，这是退出标题编辑的主路径）。
    // 点在自己那圈选中框上不算空白——框比图元外扩 6px，贴着边缘调整时不该把选中弄丢。
    const inRing = !!(ev.target as Element | null)?.closest?.('.ring')
    if (props.selected !== null && !inRing) emit('select', null)
    return
  }
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

/** 按下旋转手柄：进入旋转会话。手柄自带 stop，事件不会走到整层的按下逻辑 */
function onRotateStart(ev: PointerEvent, box: ElementBox) {
  ev.stopPropagation() // 不让整层把这次按下当成「点空白」或「拖动元素」
  const point = pointOf(ev)
  if (!point) return
  const anchor = anchorOf(box.id as SelectionId)
  if (!anchor) return
  ev.preventDefault() // 旋转期间不要顺带选中页面文字
  beginRotate({ id: box.id as SelectionId, anchor, canvas: props.state.canvas, point })
}

/** 按下拉大手柄：进入拉大会话。手柄自带 stop，事件不会走到整层的按下逻辑 */
function onScaleStart(ev: PointerEvent, box: ElementBox) {
  ev.stopPropagation() // 不让整层把这次按下当成「点空白」或「拖动元素」
  const point = pointOf(ev)
  if (!point) return
  const anchor = anchorOf(box.id as SelectionId)
  if (!anchor) return
  ev.preventDefault() // 拉大期间不要顺带选中页面文字
  beginScale({ id: box.id as SelectionId, anchor, canvas: props.state.canvas, point })
}

/** 手柄上的按下只属于手柄自己：× 按钮不需要按住拖动，但同样不能冒泡成取消选中 */
function onHandlePress(ev: PointerEvent) {
  ev.stopPropagation()
  ev.preventDefault()
}

function onPointerMove(ev: PointerEvent) {
  if (!dragging.value && !rotating.value && !scaling.value) return
  const point = pointOf(ev)
  if (!point) return
  if (rotating.value) {
    const turned = rotateTo(point, props.state.canvas)
    if (!turned) return
    emit('anchor', turned.id, { rotation: turned.rotation })
    return
  }
  if (scaling.value) {
    // 当前倍率从状态里读（与滚轮同一份来源）：写回的倍率在「倍率归位为 1」的元素上
    // 表示乘多少，在其他元素上表示新的倍率，工作台的写回路径据此折算
    const id = props.selected
    const current = id ? anchorOf(id) : null
    if (!current) return
    const sized = scaleTo(point, props.state.canvas, current.scale)
    if (!sized) return
    emit('anchor', sized.id, { scale: sized.scale })
    return
  }
  const next = move(point, {
    canvas: props.state.canvas, boxes: boxes.value, snap: props.guides,
  })
  if (!next) return
  emit('anchor', next.id, { x: next.x, y: next.y })
}

function onPointerEnd() {
  end()
}

/** 点选中框上的 ×：只上报意图，动作策略由 deleteSelection 统一决定 */
function onDelete(id: string) {
  emit('delete', id as SelectionId)
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
    :class="{ 'is-dragging': dragging, 'is-rotating': rotating, 'is-scaling': scaling }"
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
        <span class="tag" aria-hidden="true">{{ box.label }}</span>
        <!-- 手柄放在选中框内部：框随元素旋转，手柄也就跟着转到该在的角上。
             图标一律 currentColor 描边，颜色取按钮上的 color（主题青一族），不引入新色 -->
        <button
          v-if="canDeleteSelection(box.id as SelectionId)"
          type="button"
          class="handle handle-delete"
          aria-label="删除元素"
          @pointerdown="onHandlePress"
          @click.stop="onDelete(box.id)"
        >
          <svg class="handle-icon" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
            <path
              d="M3.6 3.6 10.4 10.4M10.4 3.6 3.6 10.4"
              fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"
            />
          </svg>
        </button>
        <button
          type="button"
          class="handle handle-rotate"
          aria-label="旋转元素"
          @pointerdown="onRotateStart($event, box)"
        >
          <svg class="handle-icon" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
            <path
              d="M11.9 7A4.9 4.9 0 1 1 8.34 2.34"
              fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"
            />
            <path
              d="M11.9 1.2v3.1h-3.1"
              fill="none" stroke="currentColor" stroke-width="1.4"
              stroke-linecap="round" stroke-linejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          class="handle handle-scale"
          aria-label="拉大元素"
          @pointerdown="onScaleStart($event, box)"
        >
          <svg class="handle-icon" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
            <circle
              cx="6.1" cy="6.1" r="4.1"
              fill="none" stroke="currentColor" stroke-width="1.4"
            />
            <path
              d="M9.2 9.2 12.4 12.4"
              fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"
            />
          </svg>
        </button>
      </div>
    </template>

    <div v-if="guides" class="guides" aria-hidden="true">
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

/* 拖动/旋转/拉大中关掉过渡：选中框若还在做补间，会明显落后于跟手的图元 */
.ov.is-dragging .ring,
.ov.is-rotating .ring,
.ov.is-scaling .ring {
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

/* 选中框角上的手柄：删除在右上、旋转在右下、拉大在左下。
 * 配色只取主题青那一族（--sd-accent*）与「强调底上的前景」令牌，不引入新色；
 * 图标一律 currentColor 描边，跟着按钮的 color 走 */
.handle {
  position: absolute;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1.5px solid var(--sd-accent-strong);
  border-radius: 50%;
  background: var(--sd-accent-strong);
  color: var(--sd-text-on-accent);
  cursor: pointer;
  /* 手柄要能按住拖动/点击，不能被选中框的样式吃掉指针事件 */
  pointer-events: auto;
}

.handle-icon {
  display: block;
}

.handle-delete {
  right: -9px;
  top: -9px;
}

.handle-rotate {
  right: -9px;
  bottom: -9px;
  cursor: grab;
  /* 抓取光标与旋转语义一致；按下后由浏览器接管指针捕获 */
  touch-action: none;
}

.handle-rotate:active {
  cursor: grabbing;
}

.handle-scale {
  left: -9px;
  bottom: -9px;
  cursor: nwse-resize;
  touch-action: none;
}

.handle:focus-visible {
  outline: 2px solid var(--sd-accent-deep);
  outline-offset: 1px;
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
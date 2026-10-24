<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { CanvasSize } from '../lib/types'

const props = defineProps<{ svg: string; canvas: CanvasSize }>()
const box = ref<HTMLElement>()
const scale = ref(1)
/** 卸载时断开监听,避免游离观察器持有 DOM */
let resizeObserver: ResizeObserver | undefined
onMounted(() => {
  // 缩放比随当前分辨率变化：预览始终完整展示画布，不裁切
  resizeObserver = new ResizeObserver(() => {
    scale.value = Math.min(1, (box.value?.clientWidth ?? props.canvas.width) / props.canvas.width)
  })
  if (box.value) resizeObserver.observe(box.value)
})
onUnmounted(() => resizeObserver?.disconnect())
const aspect = computed(() => `${props.canvas.width} / ${props.canvas.height}`)
const innerStyle = computed(() => ({
  width: `${props.canvas.width}px`,
  height: `${props.canvas.height}px`,
  transform: `scale(${scale.value})`,
}))
</script>

<template>
  <div class="stage">
    <div class="window">
      <div class="titlebar" aria-hidden="true">
        <i></i><i></i><i></i>
        <span>预览 · 实时</span>
      </div>
      <div class="inner">
        <div
          ref="box"
          class="preview-box"
          :style="{ aspectRatio: aspect }"
          role="img"
          aria-label="封面预览"
        >
          <div class="preview-inner" :style="innerStyle" v-html="props.svg"></div>
          <!-- 指示层叠在画布之上:选中框按归一化锚点定位,与 SVG 图元共用坐标系 -->
          <slot></slot>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stage {
  /* width 显式撑满:外层 stage-col 以 place-items:center 收纳本组件,
   * 无确定宽度时内部 min(100%, 980px) 会循环解析收缩成内容宽 */
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  padding: var(--pit-sp-4) var(--pit-sp-6);
  min-width: 0;
}

/* macOS 风预览窗:半透明材质 + 红绿灯窗控 */
.window {
  width: min(100%, 980px);
  border-radius: var(--sd-r-window);
  overflow: hidden;
  background: var(--sd-surface-panel);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  backdrop-filter: blur(24px) saturate(160%);
  border: 1px solid var(--sd-edge-bright);
  box-shadow:
    var(--sd-shadow-window),
    inset 0 1px 0 var(--sd-edge-hairline);
  animation: sd-rise var(--sd-dur-window) var(--sd-ease) var(--sd-delay-window) both;
}
.titlebar {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 11px 14px;
  background: var(--sd-surface-titlebar);
  border-bottom: 1px solid var(--sd-line);
}
.titlebar i {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  display: block;
}
.titlebar i:nth-child(1) {
  background: var(--sd-tl-red);
}
.titlebar i:nth-child(2) {
  background: var(--sd-tl-yellow);
}
.titlebar i:nth-child(3) {
  background: var(--sd-tl-green);
}
.titlebar span {
  margin-left: auto;
  font-size: var(--sd-fs-sm);
  font-weight: 500;
  color: var(--sd-text-2);
}
.inner {
  padding: var(--pit-sp-3);
}

/* 画布容器:锁定 1200:630,缩放由 ResizeObserver 驱动 */
.preview-box {
  position: relative;
  width: 100%;
  overflow: hidden;
  border-radius: var(--sd-r-control);
  box-shadow: var(--sd-shadow-card);
}

/* v-html 注入的 SVG 不接收指针事件,画布只作预览 */
.preview-inner {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: top left;
  pointer-events: none;
}
.preview-inner :deep(svg) {
  display: block;
}
</style>

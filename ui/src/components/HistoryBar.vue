<script setup lang="ts">
/**
 * 撤销 / 重做按钮条。
 *
 * 只负责「看起来禁用、按下去发事件」,不持有历史状态:
 * 历史归 useHistory,接线由工作台负责。所以本组件自身不定位,
 * 放进任何横向布局里都只占一行。
 */
const props = defineProps<{
  canUndo: boolean
  canRedo: boolean
}>()

const emit = defineEmits<{
  (e: 'undo'): void
  (e: 'redo'): void
}>()

// 原生 disabled 已经拦住真实点击;这里再守一道,
// 免得程序化派发的合成事件在禁用态仍把命令发出去
function emitUndo() {
  if (props.canUndo) emit('undo')
}

function emitRedo() {
  if (props.canRedo) emit('redo')
}
</script>

<template>
  <div class="history-bar" role="group" aria-label="撤销与重做">
    <!-- 图标一律 currentColor 描边(与 CanvasOverlay 手柄同一画法):
         左弯箭头 = 撤销,右弯箭头 = 重做 -->
    <button
      type="button"
      class="hb-btn"
      aria-label="撤销"
      :disabled="!canUndo"
      :aria-disabled="!canUndo"
      @click="emitUndo"
    >
      <svg class="hb-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path
          d="M5.4 2.4 2.4 5.4l3 3"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M2.4 5.4h5.9a3.1 3.1 0 0 1 0 6.2H5.6"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
        />
      </svg>
    </button>
    <button
      type="button"
      class="hb-btn"
      aria-label="重做"
      :disabled="!canRedo"
      :aria-disabled="!canRedo"
      @click="emitRedo"
    >
      <svg class="hb-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path
          d="M8.6 2.4 11.6 5.4l-3 3"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M11.6 5.4H5.7a3.1 3.1 0 0 0 0 6.2H8.4"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
        />
      </svg>
    </button>
  </div>
</template>

<style scoped>
/* 只做横向排布,不定位:外部放进哪一段布局由工作台决定 */
.history-bar {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
}

/* 图标按钮:28×28 命中区,视觉只靠图标本身,不画常驻外框。
 * 颜色只取现有令牌:文字档(--sd-text*)、描线档(--sd-line)、
 * 主题青一族(--sd-accent*),不引入新色 */
.hb-btn {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  min-width: 28px;
  min-height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--sd-r-small);
  background: transparent;
  color: var(--sd-text-2);
  cursor: pointer;
  transition:
    color var(--sd-dur-hover) var(--sd-ease),
    background var(--sd-dur-hover) var(--sd-ease),
    opacity var(--sd-dur-hover) var(--sd-ease);
}

/* 可用时 hover 给一层极淡的墨色底 + 主题青图标;禁用态不触发 */
.hb-btn:hover:not(:disabled) {
  background: var(--sd-line);
  color: var(--sd-accent-strong);
}

.hb-btn:active:not(:disabled) {
  background: var(--sd-line-strong);
  color: var(--sd-accent-deep);
}

.hb-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3.5px var(--sd-focus-ring);
}

/* 不可用:变淡 + 禁用光标 */
.hb-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.hb-icon {
  display: block;
}
</style>
import { onBeforeUnmount, watch, type Ref } from 'vue'

/**
 * 浮层关闭行为(B3):open 为真期间监听 document 的 pointerdown 与 keydown,
 * 点击落在 el 之外或按 Esc 时回调 onClose(携带关闭原因,便于把焦点还给触发件)。
 * 监听随 open 的生命周期挂载/移除,组件卸载兜底清理——不重蹈评审 I2 的
 * 「全局监听只增不减」泄漏。
 */
export function useDismiss(
  el: Ref<HTMLElement | undefined>,
  open: Ref<boolean>,
  onClose: (reason: 'outside' | 'escape') => void,
): void {
  function onPointerDown(e: Event) {
    if (el.value && !el.value.contains(e.target as Node)) onClose('outside')
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose('escape')
  }
  function detach() {
    document.removeEventListener('pointerdown', onPointerDown)
    document.removeEventListener('keydown', onKeydown)
  }
  watch(
    open,
    (v) => {
      if (v) {
        document.addEventListener('pointerdown', onPointerDown)
        document.addEventListener('keydown', onKeydown)
      } else {
        detach()
      }
    },
    { immediate: true },
  )
  onBeforeUnmount(detach)
}

/**
 * 宿主(Console)运行时提供的 @vueuse/core 最小测试替身。
 * 背景:ui-plugin-bundler-kit 将 @vueuse/core 外置为全局 VueUse(插件不打包),
 * 但 @halo-dev/components 的产物以 bare import 引用它,vitest 无法解析宿主模块,
 * 故在 vitest.config.ts 中将其别名到本桩(仅测试生效,生产构建不受影响)。
 * 桩只须让宿主组件可挂载,不参与任何断言行为。
 */
import { ref } from 'vue'

/** useElementSize 桩:尺寸恒 0(宿主组件据此缩放,断言不依赖具体值) */
export function useElementSize() {
  return { width: ref(0), height: ref(0), stop: () => {} }
}

/** useThrottleFn 桩:原样透传(不做节流) */
export function useThrottleFn<T>(fn: T): T {
  return fn
}

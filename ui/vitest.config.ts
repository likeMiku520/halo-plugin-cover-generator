import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // @vueuse/core 由 Console 宿主全局提供(bundler kit 外置),vitest 以最小桩替身
      '@vueuse/core': fileURLToPath(new URL('./src/test-stubs/vueuse-core.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    exclude: [...configDefaults.exclude, 'e2e/**'],
    // @halo-dev/components 以 bare import 引宿主模块 @vueuse/core(见 test-stubs),
    // 须内联进 vitest 转换管线,别名解析才能对其生效
    server: {
      deps: {
        inline: ['@halo-dev/components'],
      },
    },
    root: fileURLToPath(new URL('./', import.meta.url)),
  },
})

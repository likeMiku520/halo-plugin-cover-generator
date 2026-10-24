import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * 视觉验证 harness 独立构建配置(本地验证用,产物进 .harness-dist/,已 gitignore)。
 * 与正式构建(ui/build.gradle → bundler-kit)完全隔离。
 */
export default defineConfig({
  root: fileURLToPath(new URL('./harness', import.meta.url)),
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: fileURLToPath(new URL('./.harness-dist', import.meta.url)),
    emptyOutDir: true,
  },
})

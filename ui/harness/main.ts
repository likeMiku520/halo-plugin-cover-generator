/**
 * 视觉验证 harness(本地视觉验证工具,随仓库分发供复现;不进插件产物):
 * 以模拟 Console 外壳(48px 顶栏)挂载真实 CoverWorkbench,
 * 后端 API 不可达时组件自带降级路径(设置回退默认值),预览与表单交互完整可用。
 *
 * 内置字体在插件内走 JAR 静态资源(M7 出包);harness 无宿主,
 * 以 bundledFontUrl prop 注入打包资产地址,保证预览/导出字体不变。
 * 运行:npx vite build --config harness.vite.config.ts && npx vite preview --config harness.vite.config.ts
 */
import { createApp } from 'vue'
import './harness.css'
import CoverWorkbench from '../src/components/CoverWorkbench.vue'
import fontUrl from '../../src/main/resources/static/fonts/DouyinSansBold.otf?url'

createApp(CoverWorkbench, { bundledFontUrl: fontUrl }).mount('#app')

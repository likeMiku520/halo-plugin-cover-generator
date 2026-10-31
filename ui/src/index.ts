import { definePlugin, type OperationItem } from '@halo-dev/ui-shared'
import { IconPalette } from '@halo-dev/components'
import { markRaw } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import type { ListedPost } from '@halo-dev/api-client'
import CoverGenerateOperation from './components/CoverGenerateOperation.vue'

/**
 * 文章列表操作项「生成封面」(扩展点 post:list-item:operation:create)。
 *
 * ⚠️ 不设 permissions 门禁:ui 权限存储在页面启动后异步填充,启动窗口期内
 * permission.has() 恒为 false,条目会被过滤成空菜单(线上「没有入口」的根因);
 * 宿主自带项(编辑/发布)均不挂 permissions,越权操作由服务端鉴权兜底。
 *
 * ⚠️ 本文件只保留 default 导出(评审#7,原 IIFE 单文件契约已随 requires >=2.26 失效):
 * bundler-kit 按 plugin.yaml 的 requires 推导产物格式——>=2.26 产出 ESM 分 chunk
 * (ui-plugin.json 清单,宿主按模块注册,2.26 官方能力),更低版本回退 IIFE。
 * ESM 校验要求入口含唯一 default 导出;保持「无具名导出」约定避免产物
 * 命名空间形态漂移,需要在测试中取工厂时,从 definePlugin 结果的
 * extensionPoints 上取。
 */
function coverGenerateOperation(post: MaybeRefOrGetter<ListedPost>): OperationItem<ListedPost>[] {
  return [
    {
      priority: 21, // 内置项以 0/10/20 排布,置于其后
      component: markRaw(CoverGenerateOperation),
      props: { post }, // 行级文章 Ref,弹窗绑定始终取最新值
      label: '生成封面',
    },
  ]
}

export default definePlugin({
  components: {},
  routes: [
    {
      parentName: 'Root',
      route: {
        path: '/cover-generator',
        name: 'CoverGenerator',
        component: () => import('./components/CoverWorkbench.vue'),
        meta: {
          title: '封面生成器',
          searchable: true,
          menu: {
            name: '封面生成器',
            // 放在顶层「dashboard」分组而不是「工具」:封面生成器是日常编辑流程的一环,
            // 沉到工具分类里每次都要多找一层。priority 1 = 紧跟仪表盘之后
            // CoreMenuGroupId 的合法取值见 @halo-dev/ui-shared: dashboard/content/interface/system/tool
            group: 'dashboard',
            icon: markRaw(IconPalette),
            priority: 1,
          },
        },
      },
    },
  ],
  extensionPoints: {
    'post:list-item:operation:create': coverGenerateOperation,
  },
})

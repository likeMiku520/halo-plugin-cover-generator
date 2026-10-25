import { defineComponent } from 'vue'

/**
 * FormKit 在单元测试里的替身。
 *
 * Halo 的 iconify / attachment / color 三个输入由 Console 在运行时注册,
 * 测试环境里既没有 FormKit 插件也没有这些输入,直接挂载真实组件会抛 E600;
 * 而本插件对它们的职责只有一条契约——接住回填的值。因此替身只保留这条契约:
 * 渲染一个带 data-formkit 标记的按钮,测试用 $emit('input', 值) 驱动。
 */
export const FormKitStub = defineComponent({
  name: 'FormKit',
  props: {
    type: { type: String, default: '' },
    format: { type: String, default: '' },
    accepts: { type: Array, default: () => [] },
    multiple: { type: Boolean, default: false },
  },
  emits: ['input'],
  template: '<button type="button" :data-formkit="type">{{ type }}</button>',
})
import { config } from '@vue/test-utils'
import { FormKitStub } from './formkit'

/**
 * 全局测试装配。
 *
 * Halo 的 FormKit 输入(iconify / attachment / color)由 Console 在运行时注册,
 * 测试环境里没有这些输入,挂载会抛 E600。这里统一把 FormKit 换成替身,
 * 而不是让每个 spec 各自挂桩——组件树上共有三十多处 mount,逐个维护必然遗漏。
 */
config.global.stubs = { FormKit: FormKitStub }
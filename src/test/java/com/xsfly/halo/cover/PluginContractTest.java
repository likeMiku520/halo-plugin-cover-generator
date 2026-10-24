package com.xsfly.halo.cover;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 声明式契约守护(评审M14):本插件的服务端行为几乎全部由 YAML 声明,
 * 它们与 UI 侧硬编码常量的一致性此前无任何自动化守护。这里以纯文本断言
 * 锁定关键不变量——手滑改名/改版本在测试期即失败,而非运行期静默断裂。
 */
class PluginContractTest {

    private static String read(String path) throws Exception {
        return Files.readString(Path.of("src/main/resources", path));
    }

    @Test
    void requiresHalo226OrLater() throws Exception {
        // bundler-kit 按该值推导 UI 产物格式(ESM 分 chunk 仅 2.26+ 宿主可加载)。
        // 注意保持三段式版本号:两段式(如 >=2.27)会被解析器静默回退 IIFE(评审M17)
        assertTrue(read("plugin.yaml").contains("requires: \">=2.26.0\""),
                "plugin.yaml requires 必须为 >=2.26.0(三段式)");
    }

    @Test
    void settingNameAndConfigMapNameMatchSettingYaml() throws Exception {
        String plugin = read("plugin.yaml");
        String setting = read("extensions/setting.yaml");
        // UI 侧 usePluginSettings.ts 硬编码同名 ConfigMap 路径与 FORM_GROUP='base'
        assertTrue(plugin.contains("settingName: cover-generator-settings"));
        assertTrue(setting.contains("name: cover-generator-settings"));
        assertTrue(plugin.contains("configMapName: cover-generator-configmap"));
        assertTrue(setting.contains("group: base"));
    }

    @Test
    void fontReverseProxyContractMatchesBuiltinFontUrl() throws Exception {
        String proxy = read("extensions/reverseproxy.yaml");
        // UI 侧 BUILTIN_FONT_URL = /plugins/cover-generator/assets/fonts/DouyinSansBold.otf
        assertTrue(proxy.contains("path: /fonts/**"));
        assertTrue(proxy.contains("directory: static/fonts"));
        assertTrue(Files.exists(Path.of("src/main/resources/static/fonts/DouyinSansBold.otf")),
                "ReverseProxy 暴露的字体文件必须真实存在于 static/fonts");
    }

    @Test
    void fontAttachmentAcceptsMimeTypes() throws Exception {
        // accepts 需为 MIME 写法:扩展名写法依赖宿主正则匹配 mediaType 的巧合(评审#8)
        String setting = read("extensions/setting.yaml");
        assertTrue(setting.contains("font/otf"));
        assertTrue(setting.contains("font/woff2"));
        assertFalse(setting.contains("\".otf\""), "字体 accepts 禁止回退为扩展名写法");
    }
}

package com.xsfly.halo.cover;

import org.springframework.stereotype.Component;
import run.halo.app.plugin.BasePlugin;
import run.halo.app.plugin.PluginContext;

/**
 * <p>Plugin main class to manage the lifecycle of the plugin.</p>
 * <p>This class must be public and have a public constructor.</p>
 * <p>Only one main class extending {@link BasePlugin} is allowed per plugin.</p>
 *
 * @author xsfly
 * @since 1.0.0
 */
@Component
public class CoverGeneratorPlugin extends BasePlugin {

    public CoverGeneratorPlugin(PluginContext pluginContext) {
        super(pluginContext);
    }

    // 壳插件:渲染全部在 Console UI 端,服务端生命周期无需处理,保持静默
}

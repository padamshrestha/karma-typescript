"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Framework = (function () {
    function Framework(bundler, compiler, config, coverage, project, resolver, transformer) {
        var _this = this;
        this.create = function (karmaConfig, helper, logger) {
            _this.log = logger.create("framework.karma-typescript");
            config.initialize(karmaConfig);
            project.initialize();
            bundler.initialize(project.getModuleFormat());
            compiler.initialize(project.getTsconfig());
            coverage.initialize(helper, logger);
            resolver.initialize();
            transformer.initialize(project.getTsconfig());
            if (!config.hasFramework("commonjs")) {
                bundler.attach(karmaConfig.files);
            }
            config.bundlerOptions.transforms.forEach(function (t) {
                if (t.initialize) {
                    t.initialize({
                        appenders: karmaConfig.loggers,
                        level: karmaConfig.logLevel
                    });
                }
            });
            _this.log.debug("Karma config:\n", JSON.stringify(karmaConfig, null, 3));
        };
        this.create.$inject = ["config", "helper", "logger"];
    }
    return Framework;
}());
exports.Framework = Framework;

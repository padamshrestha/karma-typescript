import * as acorn from "acorn";
import * as async from "async";
import * as browserResolve from "browser-resolve";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { Logger } from "log4js";

import { Configuration } from "../shared/configuration";
import PathTool = require("../shared/path-tool");
import { DependencyWalker } from "./dependency-walker";
import { RequiredModule } from "./required-module";
import SourceMap = require("./source-map");
import { Transformer } from "./transformer";

export class Resolver {

    private builtins: any;
    private filenameCache: string[] = [];
    private lookupNameCache: { [key: string]: string; } = {};

    constructor(private config: Configuration,
                private dependencyWalker: DependencyWalker,
                private log: Logger,
                private transformer: Transformer) { }

    public initialize() {
        this.builtins = this.config.bundlerOptions.addNodeGlobals ?
            require("browserify/lib/builtins") : undefined;
    }

    public resolveModule(requiringModule: string,
                         requiredModule: RequiredModule,
                         buffer: RequiredModule[],
                         onRequiredModuleResolved: { (requiredModule?: RequiredModule): void }) {

        requiredModule.lookupName = requiredModule.isNpmModule() ?
                requiredModule.moduleName :
                path.join(path.dirname(requiringModule), requiredModule.moduleName);

        if (this.lookupNameCache[requiredModule.lookupName]) {
            requiredModule.filename = this.lookupNameCache[requiredModule.lookupName];
            process.nextTick(() => {
                onRequiredModuleResolved(requiredModule);
            });
            return;
        }

        if (this.config.bundlerOptions.exclude.indexOf(requiredModule.moduleName) !== -1) {
            this.log.debug("Excluding module %s from %s", requiredModule.moduleName, requiringModule);
            process.nextTick(() => {
                onRequiredModuleResolved();
            });
            return;
        }

        let onFilenameResolved = () => {

            this.lookupNameCache[requiredModule.lookupName] = requiredModule.filename;

            if (this.filenameCache.indexOf(requiredModule.filename) !== -1 ||
                requiredModule.filename.indexOf(".ts") !== -1) {
                process.nextTick(() => {
                    onRequiredModuleResolved(requiredModule);
                });
                return;
            }
            else {
                this.filenameCache.push(requiredModule.filename);
                this.readSource(requiredModule, onSourceRead);
            }
        };

        let onSourceRead = () => {

            if (!requiredModule.isScript()) {
                if (requiredModule.isJson()) {
                    requiredModule.source = os.EOL +
                        "module.isJSON = true;" + os.EOL +
                        "module.exports = JSON.parse(" + JSON.stringify(requiredModule.source) + ");";
                }
                else {
                    requiredModule.source = os.EOL + "module.exports = " + JSON.stringify(requiredModule.source) + ";";
                }
            }

            requiredModule.ast = acorn.parse(requiredModule.source, this.config.bundlerOptions.acornOptions);
            this.transformer.applyTransforms(requiredModule, (error: Error) => {
                if (error) {
                    throw Error;
                }
                this.resolveDependencies(requiredModule, buffer, onDependenciesResolved);
            });
        };

        let onDependenciesResolved = () => {
            buffer.push(requiredModule);
            return onRequiredModuleResolved(requiredModule);
        };

        this.resolveFilename(requiringModule, requiredModule, onFilenameResolved);
    }

    private resolveFilename(requiringModule: string, requiredModule: RequiredModule, onFilenameResolved: { (): void }) {

        let bopts = {
            extensions: this.config.bundlerOptions.resolve.extensions,
            filename: requiredModule.isNpmModule() ? undefined : requiringModule,
            moduleDirectory: this.config.bundlerOptions.resolve.directories,
            modules: this.builtins,
            pathFilter: this.pathFilter.bind(this)
        };

        browserResolve(requiredModule.moduleName, bopts, (error, filename) => {
            if (error) {
                throw new Error("Unable to resolve module [" +
                    requiredModule.moduleName + "] from [" + requiringModule + "]");
            }
            requiredModule.filename = filename;
            onFilenameResolved();
        });
    }

    private pathFilter(pkg: any, fullPath: string, relativePath: string): string {

        let filteredPath;
        let normalizedPath = PathTool.fixWindowsPath(fullPath);

        Object
            .keys(this.config.bundlerOptions.resolve.alias)
            .forEach((moduleName) => {
                let regex = new RegExp(moduleName);
                if (regex.test(normalizedPath) && pkg && relativePath) {
                    filteredPath = path.join(fullPath, this.config.bundlerOptions.resolve.alias[moduleName]);
                }
            });

        if (filteredPath) {
            return filteredPath;
        }
    }

    private readSource(requiredModule: RequiredModule, onSourceRead: { (source?: string): void }) {

        if (this.config.bundlerOptions.ignore.indexOf(requiredModule.moduleName) !== -1) {
            onSourceRead("module.exports={};");
        }
        else {
            fs.readFile(requiredModule.filename, (error, data) => {
                if (error) {
                    throw error;
                }
                requiredModule.source = SourceMap.deleteComment(data.toString());
                onSourceRead();
            });
        }
    }

    private resolveDependencies(requiredModule: RequiredModule,
                                buffer: RequiredModule[],
                                onDependenciesResolved: { (): void }) {

        requiredModule.requiredModules = [];

        if (requiredModule.isScript() &&
            this.config.bundlerOptions.noParse.indexOf(requiredModule.moduleName) === -1 &&
            this.dependencyWalker.hasRequire(requiredModule.source)) {

            let moduleNames = this.dependencyWalker.collectRequiredJsModules(requiredModule);

            async.each(moduleNames, (moduleName, onModuleResolved) => {
                let dependency = new RequiredModule(moduleName);
                this.resolveModule(requiredModule.filename, dependency, buffer, (resolved) => {
                    if (resolved) {
                        requiredModule.requiredModules.push(resolved);
                    }
                    onModuleResolved();
                });
            }, onDependenciesResolved);
        }
        else {
            process.nextTick(() => {
                onDependenciesResolved();
            });
        }
    }
}

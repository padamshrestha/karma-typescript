import glob = require("glob");
import path = require("path");

import * as ts from "typescript";

import { Logger } from "log4js";

import Queued = require("./queued");
import RequiredModule = require("./required-module");

class DependencyWalker {

    private log: Logger;
    private requireRegexp = /\brequire\b/;
    private walk = require("acorn/dist/walk");

    public initialize(logger: any) {
        this.log = logger.create("dependency-walker.karma-typescript");
    }

    public hasRequire(s: string): boolean {
        return this.requireRegexp.test(s);
    }

    public collectRequiredTsModules(queue: Queued[]): number {

        let requiredModuleCount: number = 0;

        queue.forEach((queued) => {

            queued.module.requiredModules = this.findUnresolvedTsRequires(queued.emitOutput.sourceFile);

            if ((<any> queued.emitOutput.sourceFile).resolvedModules &&
                !queued.emitOutput.sourceFile.isDeclarationFile) {

                Object.keys((<any> queued.emitOutput.sourceFile).resolvedModules).forEach((moduleName) => {
                    let resolvedModule = (<any> queued.emitOutput.sourceFile).resolvedModules[moduleName];
                    queued.module.requiredModules.push(
                        new RequiredModule(moduleName, resolvedModule && resolvedModule.resolvedFileName));
                });
            }

            requiredModuleCount += queued.module.requiredModules.length;
        });

        return requiredModuleCount;
    }

    public collectRequiredJsModules(requiredModule: RequiredModule): string[] {

        let moduleNames: string[] = [];
        let expressions: any[] = [];

        let isRequire = (node: any) => {
            return node.type === "CallExpression" &&
                    node.callee.type === "Identifier" &&
                    node.callee.name === "require"
            ;
        };

        let visit = (node: any, state: any, c: any)  => {
            if (!this.hasRequire(requiredModule.source.slice(node.start, node.end))) {
                return;
            }
            this.walk.base[node.type](node, state, c);
            if (isRequire(node) && node.arguments.length > 0) {
                if (node.arguments[0].type === "Literal") {
                    moduleNames.push(node.arguments[0].value);
                }
                else {
                    expressions.push(node.arguments[0]);
                }
            }
        };

        this.walk.recursive(requiredModule.ast, null, {
            Expression: visit,
            Statement: visit
        });

        this.addDynamicDependencies(expressions, moduleNames, requiredModule);

        return moduleNames;
    }

    private findUnresolvedTsRequires(sourceFile: ts.SourceFile): RequiredModule[] {

        let requiredModules: RequiredModule[] = [];

        if ((<any> ts).isDeclarationFile(sourceFile)) {
            return requiredModules;
        }

        let visitNode = (node: ts.Node) => {

            if (node.kind === ts.SyntaxKind.CallExpression) {

                let ce = (<ts.CallExpression> node);

                let expression = ce.expression ?
                    (<ts.LiteralExpression> ce.expression) :
                    undefined;

                let argument = ce.arguments && ce.arguments.length ?
                    (<ts.LiteralExpression> ce.arguments[0]) :
                    undefined;

                if (expression && expression.text === "require" &&
                    argument && typeof argument.text === "string") {
                    requiredModules.push(new RequiredModule(argument.text));
                }
            }

            ts.forEachChild(node, visitNode);
        };

        visitNode(sourceFile);

        return requiredModules;
    }

    private addDynamicDependencies(expressions: any[], moduleNames: string[], requiredModule: RequiredModule) {

        expressions.forEach((expression) => {

            let dynamicModuleName = this.parseDynamicRequire(expression);
            let directory = path.dirname(requiredModule.filename);
            let pattern: string;
            let files: string[];

            if (dynamicModuleName && dynamicModuleName !== "*") {
                if (new RequiredModule(dynamicModuleName).isNpmModule()) {
                    moduleNames.push(dynamicModuleName);
                }
                else {
                    pattern = path.join(directory, dynamicModuleName);
                    files = glob.sync(pattern);
                    files.forEach((filename) => {
                        this.log.debug("Dynamic require: \nexpression: [%s]\nfilename: %s\nrequired by %s\nglob: %s",
                            JSON.stringify(expression, undefined, 3), filename, requiredModule.filename, pattern);
                        moduleNames.push("./" + path.relative(directory, filename));
                    });
                }
            }
        });
    }

    private parseDynamicRequire(expression: any): string {

        let visit = (node: any): string => {
            switch (node.type) {
            case "BinaryExpression":
                if (node.operator === "+") {
                    return visit(node.left) + visit(node.right);
                }
                break;
            case "ExpressionStatement":
                return visit(node.expression);
            case "Literal":
                return node.value + "";
            case "Identifier":
                return "*";
            default:
                return "";
            }
        };

        return visit(expression);
    }
}

export = DependencyWalker;
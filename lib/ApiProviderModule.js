const {Application, Module} = require('mf-lib');
const NanoApi = require('./NanoApi');

class ApiProvider_Module extends Module {
    apis = {};

    async init() {
        const apis = this.config.get("apis", {});
        for (const [moduleName, apiDef] of Object.entries(apis)) {
            const module = Application.getModule(moduleName);
            if (module) {
                this.registerApi(module.name, module, apiDef, {name: module.name});
            }
        }
    }

    async initModule(module) {
        if (module.data && module.data.apis) {
            for (const api of module.data.apis) {
                this.registerApi(module.name, module, api, {name: module.name});
            }
        }
    }

    async postInit() {
        const router = this.app.getModule('webserver').getRouter();
        for (let [, api] of Object.entries(this.apis)) {
            api.exposeRoutes(router);
        }
    }

    registerApi(moduleName, module, apiDef, options) {
        this.apis[moduleName] = new NanoApi(module, apiDef, Object.assign({prefix: moduleName}, options));
    }
}

module.exports = ApiProvider_Module;

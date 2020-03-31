const {Application, Module, Modules: {mpath}} = require('mf-lib');
const Webserver = require('mf-webserver');

class NanoApi {
    /**
     * Creates a simple api
     * @param {object} apiClasses {file:{action:async fnc}}
     * @param {object} apiDef {version, routes:{path:{method:{}}}}
     * @param {object} options {name: string}
     */
    constructor(apiClasses, apiDef, options = {}) {
        this.options = options;
        this.apiClasses = apiClasses;
        this.apiDef = apiDef;
        this.formatParsers = [];
    }

    /**
     * Register parser
     * @param fnc
     * @param types
     */
    registerParser(fnc, types = []) {
        this.formatParsers.push({
            parse: fnc,
            types: types
        });
    }

    /**
     * Expose api routes to external koa-router
     * @param {koaRouter.middleware|Object} router
     */
    exposeRoutes(router) {
        this.router = router;
        this.router.get(`/api/${this.options.prefix}/v${this.apiDef.version}/api.json`, (ctx, next) => {
            ctx.body = this.apiDef;
        });

        this._loadRoutes();
    }

    /**
     * Loads api routes
     * @private
     */
    _loadRoutes() {
        for (let [route, cfg] of Object.entries(this.apiDef.routes)) {
            if (cfg.get || cfg.post || cfg.put || cfg.update || cfg.delete || cfg.head) {
                for (let [option, data] of Object.entries(cfg)) {
                    this._registerRoute(route, option, data);
                }
            } else {
                this.router.get(route, async () => {
                    this._registerRoute(route, "get", cfg);
                });
            }
        }
    }

    /**
     * Register api route
     * @param {string} route
     * @param {string} type (get|post|put|update|delete|head)
     * @param {object} cfg {file, action, params, response}
     * @private
     */
    _registerRoute(route, type, cfg) {
        cfg = Object.assign({
            action: "default",
            file: "default",
            params: {},
            response: {}
        }, cfg);

        route = `/api/${this.options.prefix}/v${this.apiDef.version}/${route}`;

        let fnc = null;
        let parent = null;

        if (!cfg.handler) {
            throw new Error(`No handler found for ${route}.`);
        } else if (cfg.handler.group && cfg.handler.action) {
            fnc = this.apiClasses[cfg.handler.group][cfg.handler.action];
            parent = this.apiClasses[cfg.handler.group];
        } else if (!cfg.handler.group && cfg.handler.action) {
            fnc = this.apiClasses[cfg.handler.action];
            parent = this.apiClasses;
        }

        this.router[type](route, async (ctx, next) => {
            try {
                const params = this._formatParameters(ctx, cfg);
                const res = await fnc.apply(parent, this._buildArguments(params, cfg));
                if (res) {
                    ctx.body = res;
                }
                ctx.body = this._formatResponse(ctx, cfg, ctx.body);
            } catch (e) {
                console.log(`Error executing route ${route} ${e}.`);
                console.log(e);

                ctx.response.status = 500;
                ctx.body = {
                    message: e.toString()
                };
            }
        });
    }

    /**
     * Builds arguments from mapping and params
     * @param {object} params
     * @param {object} cfg
     * @returns {[*]}
     * @private
     */
    _buildArguments(params, cfg) {
        if (!(cfg.handler && cfg.handler.mapping)) {
            return [];
        }
        return cfg.handler.mapping.map((path) => mpath.get(path, params));
    }

    /**
     * Formats all parameters
     * @param ctx
     * @param {object} cfg
     * @returns {object}
     * @private
     */
    _formatParameters(ctx, cfg) {
        const params = ctx.params;
        const queryParams = cfg.params.query ? this._format(Object.assign({}, ctx.request.query, ctx.params), cfg.params.query) : {};
        const bodyParams = cfg.params.body ? this._format(ctx.request.body, cfg.params.body) : {};
        const headerParams = cfg.params.header ? this._format(ctx.request.header, cfg.params.header) : {};
        return Object.assign({ctx}, params, queryParams, bodyParams, headerParams);
    }

    /**
     * Formats response into schema from cfg
     * @param ctx
     * @param {object} cfg
     * @param {object} data
     * @returns {*}
     * @private
     */
    _formatResponse(ctx, cfg, data) {
        const response = cfg.response[ctx.response.status];
        if (!(response && response.schema)) {
            return data;
        }
        return this._format({data: data}, {data: response.schema}).data;
    }

    /**
     * Fits object into schema
     * @param {object} schema {key: data}
     * @param {object} data {key: schema}
     * @returns {object}
     * @private
     */
    _format(data, schema) {
        for (let [key, other] of Object.entries(Object.assign({}, data, schema))) {
            if (data[key] && schema[key]) {
                const type = String(schema[key].type).toLowerCase();
                switch (type) {
                    case "string":
                        if (typeof data[key] !== "string") {
                            data[key] = String(data[key]);
                        }
                        break;
                    case "number":
                    case "double":
                    case "float":
                        if (typeof data[key] !== "number") {
                            data[key] = parseFloat(data[key]);
                        }
                        break;
                    case "int":
                    case "int64":
                        if (typeof data[key] !== "number") {
                            data[key] = parseInt(data[key]);
                        }
                        break;
                    case "array":
                        for (let [index, value] of Object.entries(data[key])) {
                            data[key][index] = this._format({data: value}, {data: schema[key].item}).data;
                        }
                        break;
                    case "object":
                        data[key] = this._format(data[key], schema[key].fields);
                        break;
                    case "date":
                        data[key] = new Date(data[key]);
                        break;
                    default:
                        const parser = this.formatParsers.find((parser) => parser.types.indexOf(type) !== -1);
                        if (parser) {
                            try {
                                data[key] = parser.parse.apply({format: this._format}, data[key]);
                            } catch (e) {

                            }
                        }
                }
            } else if (schema[key] && schema[key].default !== undefined) {
                data[key] = schema[key].default;
            } else if (data[key]) {
                delete data[key];
            }
        }
        return data;
    }
}

class ApiProvider_Module extends Module {
    apis = {};

    async init() {
        const apis = this.config.get("apis", {});
        for (let [moduleName, apiDoc] of Object.entries(apis)) {
            const module = Application.getModule(moduleName);
            if (module) {
                this.registerApi(module.name, module, apiDoc, {name: module.name});
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
        const router = Webserver.getRouter();
        for (let [, api] of Object.entries(this.apis)) {
            api.exposeRoutes(router);
        }
    }

    registerApi(name, apiClasses, apiDef, options) {
        this.apis[name] = new NanoApi(apiClasses, apiDef, Object.assign({prefix: name}, options));
    }
}

module.exports = new ApiProvider_Module();
module.exports.NanoApi = NanoApi;

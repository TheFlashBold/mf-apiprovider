import axios from "axios";

class ApiClient {
  async load(definitionUrl) {
    const { data: definition } = await axios.get(definitionUrl + "api.json");
    this.definition = definition;

    for (const [path, cfg] of Object.entries(definition.routes)) {
      for (const [method, { handler, params }] of Object.entries(cfg)) {
        let { group, action, mapping } = handler;
        // ctx is server-side only
        mapping = mapping.filter((v) => v !== "ctx");

        if (group && !this[group]) {
          this[group] = {};
        }

        const fnc = async function () {
          const config = {
            method: method,
            url: definitionUrl + path,
          };

          if (params.url) {
            for (let i = 0; i < mapping.length; i++) {
              config.url = config.url.replace(
                new RegExp(":" + mapping[i], "i"),
                arguments[i]
              );
            }
          }

          if (params.query) {
            const query = {};
            for (const [field, { default: defaultValue }] of Object.entries(
              params.query
            )) {
              query[field] = arguments[mapping.indexOf(field)] || defaultValue;
            }
            if (Object.keys(query).length) {
              config.url =
                "?" +
                Object.entries(query)
                  .map(
                    ([key, value]) =>
                      encodeURIComponent(key) + "=" + encodeURIComponent(value)
                  )
                  .join("&");
            }
          }

          if (["post", "put", "patch"].includes(method) && params.body) {
            config.data = {};

            for (const [field, { default: defaultValue }] of Object.entries(
              params.body
            )) {
              config.data[field] =
                arguments[mapping.indexOf(field)] || defaultValue;
            }
          }

          const { data } = await axios(config);
          return data;
        }.bind(this);

        if (group) {
          this[group][action] = fnc;
        } else {
          this[action] = fnc;
        }
      }
    }
    return this;
  }
}

export default ApiClient;

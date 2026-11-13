const paths = {
  rules: ["rules"],
  rule: name => ["rules", name],
  ruleTypes: ["rules", "types"],
  context: name => ["rules", "context", name],
  assistant: name => ["rules", "types", name],
  constraintOptions: name => ["rules", "types", name, "constraint-options"],
  messageClasses: ["bpl", "message-classes"],
  configItems: ["config-items"],
  classPackages: ["class-packages"],
  transforms: ["transforms"]
};

export function createInteropApi(config, { fetchImpl = globalThis.fetch } = {}) {
  async function request(resource, { name, signal, messageClass, method = "GET", payload } = {}) {
    const parts = typeof paths[resource] === "function" ? paths[resource](name) : paths[resource];
    const url = `${config.apiBase}/${[config.namespace, ...parts].map(part => encodeURIComponent(part)).join("/")}`;
    const options = { method, credentials: "same-origin", headers: { Accept: "application/json" }, signal };
    if (resource === "constraintOptions") {
      options.method = "POST";
      payload = { messageClass };
    }
    if (payload !== undefined) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(payload);
    }
    const response = await fetchImpl(url, options);
    if (!response.ok) {
      let detail = "";
      try { detail = (await response.json()).error ?? ""; } catch {}
      throw new Error(`API request failed (${response.status}): ${resource}${detail ? `: ${detail}` : ""}`);
    }
    if (response.status === 204) return null;
    if (response.text) {
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    }
    return response.json();
  }
  return {
    listRules: signal => request("rules", { signal }),
    rule: (name, signal) => request("rule", { name, signal }),
    updateRule: (name, payload, signal) => request("rule", { name, payload, signal, method: "PUT" }),
    createRule: (name, payload, signal) => request("rule", { name, payload, signal, method: "POST" }),
    ruleTypes: signal => request("ruleTypes", { signal }),
    context: (name, signal) => request("context", { name, signal }),
    assistant: (name, signal) => request("assistant", { name, signal }),
    constraintOptions: (name, messageClass, signal) => request("constraintOptions", { name, messageClass, signal }),
    messageClasses: signal => request("messageClasses", { signal }),
    configItems: signal => request("configItems", { signal }),
    classPackages: signal => request("classPackages", { signal }),
    transforms: signal => request("transforms", { signal })
  };
}

export async function loadRuleResources(api, name, types, signal) {
  const definition = await api.rule(name, signal);
  const matches = types.filter(type => (!definition.assistClass || type.name === definition.assistClass)
    && (!definition.context || type.contextClass === definition.context));
  const fallback = matches.length === 1 ? matches[0] : null;
  const assistClass = definition.assistClass || fallback?.name;
  const contextClass = definition.context || fallback?.contextClass;
  if (!assistClass || !contextClass) throw new TypeError("The rule must identify its RuleAssist and context classes.");
  const [assistant, context] = await Promise.all([api.assistant(assistClass, signal), api.context(contextClass, signal)]);
  return { definition, assistant, context, assistClass, contextClass };
}
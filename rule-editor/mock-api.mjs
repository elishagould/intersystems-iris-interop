import { readFile } from "node:fs/promises";

const fixtures = new URL("./mock-data/", import.meta.url);
const readJSON = async (namespace, path) => JSON.parse(await readFile(new URL(`${encodeURIComponent(namespace)}/${path}`, fixtures), "utf8"));

export async function createMockApi(apiBase) {
  const prefix = new URL(apiBase, "http://localhost").pathname.replace(/\/+$/, "");
  const namespaces = new Map();
  async function namespaceData(namespace) {
    if (!namespaces.has(namespace)) {
      const pending = (async () => {
        const names = await readJSON(namespace, "rules/index.json");
        const definitions = await Promise.all(names.map(name => readJSON(namespace, `rules/${encodeURIComponent(name)}.json`)));
        const types = await readJSON(namespace, "rules/types/index.json");
        return { rules: new Map(names.map((name, index) => [name, definitions[index]])), types };
      })();
      namespaces.set(namespace, pending);
      pending.catch(() => { if (namespaces.get(namespace) === pending) namespaces.delete(namespace); });
    }
    return namespaces.get(namespace);
  }
  async function readBody(request) {
    let body = "";
    for await (const chunk of request) {
      body += chunk;
      if (Buffer.byteLength(body) > 4 * 1024 * 1024) throw new RangeError("Request body too large.");
    }
    return JSON.parse(body);
  }

  function send(response, status, body, head = false, headers = {}) {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers });
    response.end(head ? undefined : JSON.stringify(body));
  }

  return async function handle(request, response) {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return false;
    const head = request.method === "HEAD";
    try {
      const [rawNamespace, ...parts] = pathname.slice(prefix.length + 1).split("/").map(decodeURIComponent);
      if (!rawNamespace?.trim() || !/^[%A-Za-z_][\w%-]*$/.test(rawNamespace)) { send(response, 400, { error: "Invalid namespace." }, head); return true; }
      const namespace = rawNamespace.toUpperCase();
      const route = parts.join("/");
      const { rules, types } = await namespaceData(namespace);
      const constraint = parts.length === 4 && parts[0] === "rules" && parts[1] === "types" && parts[3] === "constraint-options";
      const ruleRoute = parts.length === 2 && parts[0] === "rules" && parts[1] !== "types";
      const allowed = constraint ? ["POST"] : ruleRoute ? ["GET", "HEAD", "PUT", "POST"] : ["GET", "HEAD"];
      if (!allowed.includes(request.method)) {
        send(response, 405, { error: "Method not allowed." }, head, { Allow: allowed.join(", ") });
        return true;
      }
      if (ruleRoute && ["PUT", "POST"].includes(request.method)) {
        const name = parts[1];
        const existing = rules.get(name);
        if (request.method === "POST" && existing) { send(response, 409, { error: "Business rule already exists." }); return true; }
        if (request.method === "PUT" && !existing) { send(response, 404, { error: "Business rule not found." }); return true; }
        if (request.method === "PUT" && existing.ReadOnly) { send(response, 403, { error: "Business rule is read-only." }); return true; }
        const payload = await readBody(request);
        if (!/^[%A-Za-z_][\w%]*(?:\.[%A-Za-z_][\w%]*)+$/.test(name) || payload?.type !== "ruleDefinition" || !Array.isArray(payload.ruleSets)
          || !payload.assistClass || !payload.context) { send(response, 400, { error: "Invalid rule definition or class name." }); return true; }
        if (existing && payload.Timestamp && payload.Timestamp !== existing.Timestamp) { send(response, 409, { error: "Rule has changed; reload before saving." }); return true; }
        const saved = structuredClone(payload);
        saved.Timestamp = new Date(Math.max(Date.now(), (Date.parse(existing?.Timestamp) || 0) + 1)).toISOString();
        saved.ReadOnly ??= 0;
        rules.set(name, saved);
        send(response, request.method === "POST" ? 201 : 200, saved);
        return true;
      }
      let data;
      if (constraint && types.some(type => type.name === parts[2])) {
        const { messageClass } = await readBody(request);
        if (typeof messageClass !== "string" || !messageClass.trim()) {
          send(response, 400, { error: "messageClass is required." });
          return true;
        }
        const directory = `rules/types/${encodeURIComponent(parts[2])}/constraint-options/`;
        try { data = await readJSON(namespace, `${directory}${encodeURIComponent(messageClass)}.json`); }
        catch (error) {
          if (error.code !== "ENOENT") throw error;
          data = await readJSON(namespace, `${directory}index.json`);
        }
      } else if (route === "rules") data = [...rules.keys()];
      else if (route === "rules/types") data = types;
      else if (ruleRoute && rules.has(parts[1])) data = rules.get(parts[1]);
      else if (parts.length === 3 && parts[0] === "rules" && parts[1] === "types" && types.some(type => type.name === parts[2])) {
        data = await readJSON(namespace, `rules/types/${encodeURIComponent(parts[2])}.json`);
      } else if (parts.length === 3 && parts[0] === "rules" && parts[1] === "context" && types.some(type => type.contextClass === parts[2])) {
        data = await readJSON(namespace, `rules/context/${encodeURIComponent(parts[2])}.json`);
      } else if (route === "bpl/message-classes") data = await readJSON(namespace, "bpl/message-classes.json");
      else if (["config-items", "transforms", "class-packages", "sourcecontrol/menus", "sourcecontrol/status"].includes(route)) data = await readJSON(namespace, `${route}.json`);
      else { send(response, 404, { error: "Unknown mock endpoint or class." }, head); return true; }
      send(response, 200, data, head);
    } catch (error) {
      const status = error instanceof URIError || error instanceof SyntaxError ? 400 : error instanceof RangeError ? 413 : error.code === "ENOENT" ? 404 : 500;
      send(response, status, { error: status === 500 ? "Mock API error." : status === 404 ? "Mock namespace or fixture not found." : error.message }, head);
    }
    return true;
  };
}
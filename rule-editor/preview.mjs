import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createMockApi } from "./mock-api.mjs";
import { createMockAuthentication } from "./mock-auth.mjs";
import { resolveApiConfig, resolveAuthenticationConfig } from "./packages/api/config.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json" };

export async function startPreview({ port = 5173, host = "127.0.0.1", mockApi = true } = {}) {
  const settings = JSON.parse(await readFile(new URL("./config.json", import.meta.url), "utf8"));
  const handleApi = mockApi ? await createMockApi(settings.apiBase) : null;
  const authConfig = resolveAuthenticationConfig(settings, resolveApiConfig(settings, "http://localhost/?%24NAMESPACE=MOCK"));
  const handleAuth = mockApi && authConfig.enabled ? createMockAuthentication(authConfig) : null;
  const server = createServer(async (request, response) => {
    if (handleAuth && await handleAuth(request, response)) return;
    if (handleApi && await handleApi(request, response)) return;
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const path = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
      const name = relative(root, path);
      if (name.startsWith(`..${sep}`) || name === ".." || isAbsolute(name)) {
        response.writeHead(403).end();
        return;
      }
      const content = await readFile(path);
      const type = types[extname(path)] ?? "application/octet-stream";
      response.writeHead(200, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      response.writeHead(error instanceof URIError ? 400 : 404).end();
    }
  });
  for (let attempt = 0; ; attempt++) {
    try {
      await new Promise((resolveListen, rejectListen) => {
        const failed = error => { server.off("listening", ready); rejectListen(error); };
        const ready = () => { server.off("error", failed); resolveListen(); };
        server.once("error", failed);
        server.once("listening", ready);
        server.listen(port, host);
      });
      return server;
    } catch (error) {
      if (error.code !== "EADDRINUSE" || attempt >= 20 || port === 0) throw error;
      port++;
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { port: { type: "string", default: "5173" }, live: { type: "boolean", default: false } } });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError("Port must be an integer from 0 to 65535.");
  const server = await startPreview({ port, mockApi: !values.live });
  const settings = JSON.parse(await readFile(new URL("./config.json", import.meta.url), "utf8"));
  const query = settings.defaultNamespace ? `?${new URLSearchParams({ "$NAMESPACE": settings.defaultNamespace })}` : "";
  console.log(`Rule Editor V2: http://127.0.0.1:${server.address().port}/${query}`);
}
export function createMockAuthentication(config) {
  const base = new URL(config.authBase);
  const endpoints = { login: "login", refresh: "refresh", logout: "logout", revoke: "revoke", ...config.endpoints };
  const paths = Object.fromEntries(Object.entries(endpoints).map(([name, path]) => [name, new URL(path, `${base.href.replace(/\/+$/, "")}/`).pathname]));
  const infoPath = new URL(config.sessionInfoUrl).pathname;
  let portalSession = true;
  let sequence = 0;
  const refreshTokens = new Set();
  function send(response, status, body) {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(status === 204 ? undefined : JSON.stringify(body));
  }
  function tokens() {
    const suffix = ++sequence;
    const refresh = `mock-refresh-${suffix}`;
    refreshTokens.add(refresh);
    portalSession = true;
    const now = Math.floor(Date.now() / 1000);
    return { access_token: `mock-access-${suffix}`, refresh_token: refresh, sub: "MockUser", iat: now, exp: now + 300 };
  }
  return async (request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    const endpoint = Object.keys(paths).find(name => paths[name] === path);
    if (!endpoint && path !== infoPath) return false;
    if (path === infoPath) {
      if (request.method !== "GET") send(response, 405, { error: "Method not allowed." });
      else send(response, portalSession ? 200 : 401, portalSession ? { username: "MockUser" } : { error: "Sign in required." });
      return true;
    }
    if (request.method !== "POST") { send(response, 405, { error: "Method not allowed." }); return true; }
    try {
      let raw = "";
      for await (const chunk of request) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 16384) { send(response, 413, { error: "Body too large." }); return true; }
      }
      const body = raw ? JSON.parse(raw) : null;
      if (endpoint === "login") {
        if (body === null && portalSession || body?.user === "mock" && body?.password === "mock") send(response, 200, tokens());
        else send(response, 401, { error: "Invalid mock credentials." });
      } else if (endpoint === "refresh") {
        if (refreshTokens.delete(body?.refresh_token)) send(response, 200, tokens());
        else send(response, 401, { error: "Expired mock refresh token." });
      } else {
        portalSession = false;
        refreshTokens.clear();
        send(response, 204);
      }
    } catch { send(response, 400, { error: "Invalid request." }); }
    return true;
  };
}
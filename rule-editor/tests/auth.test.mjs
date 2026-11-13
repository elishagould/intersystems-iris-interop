import assert from "node:assert/strict";
import test from "node:test";
import { AuthenticationError, createAuthenticator } from "@intersystems/iris-auth";
import { createLoginController } from "@intersystems/iris-auth/login";
import { resolveApiConfig, resolveAuthenticationConfig } from "../packages/api/config.js";
import { createInteropApi } from "../packages/api/client.js";
import { startPreview } from "../preview.mjs";

const base = "https://iris.example/api/interop-editors";
const tokens = suffix => ({ access_token: `access-${suffix}`, refresh_token: `refresh-${suffix}`, sub: "TestUser", exp: 9999999999 });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const memoryStorage = () => { const data = new Map(); return { data, getItem: key => data.get(key), setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }; };
function client(fetchImpl, extra = {}) { return createAuthenticator({ authBase: base, protectedUrls: [`${base}/v8`], fetchImpl, setTimer: () => 1, clearTimer() {}, ...extra }); }

test("native login uses user/password, stores tokens but not passwords and adds bearer headers", async () => {
  const storage = memoryStorage();
  const calls = [];
  const auth = client(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    calls.push(request);
    return request.url.endsWith("/login") ? json(tokens("one")) : json({ ok: true });
  }, { storage });
  await auth.login("TestUser", "fake-password-for-test");
  assert.deepEqual(await calls[0].json(), { user: "TestUser", password: "fake-password-for-test" });
  await auth.fetch(`${base}/v8/TEST/rules`);
  assert.equal(calls[1].headers.get("Authorization"), "Bearer access-one");
  assert.equal(calls[1].credentials, "same-origin");
  assert.equal(calls[1].redirect, "error");
  assert.ok(!JSON.stringify([...storage.data]).includes("fake-password-for-test"));
  assert.deepEqual(auth.state, { authenticated: true, user: "TestUser", mode: "token" });
  auth.dispose();
});

test("authentication reuses existing portal sessions via info without fabricating a token", async () => {
  const auth = client(async (input, init) => {
    if (String(input).endsWith("/info")) return json({ username: "PortalUser" });
    assert.equal(init.body, null);
    return json({}, 401);
  });
  assert.equal(await auth.initialize(), true);
  assert.deepEqual(auth.state, { authenticated: true, user: "PortalUser", mode: "session" });
  auth.dispose();
});

test("401 refresh is shared and safely replays PUT JSON once", async () => {
  let refreshed = 0;
  const bodies = [];
  const auth = client(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.url.endsWith("/login")) return json(tokens("old"));
    if (request.url.endsWith("/refresh")) { refreshed++; assert.deepEqual(await request.json(), { refresh_token: "refresh-old" }); return json(tokens("new")); }
    bodies.push(await request.text());
    return request.headers.get("Authorization") === "Bearer access-new" ? json({ saved: true }) : json({}, 401);
  });
  await auth.login("TestUser", "fake");
  const results = await Promise.all([1, 2].map(() => auth.fetch(`${base}/v8/TEST/rules/Rules.Example`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: '{"value":"unchanged"}' })));
  assert.ok(results.every(response => response.ok));
  assert.equal(refreshed, 1);
  assert.ok(bodies.every(body => body === '{"value":"unchanged"}'));
  auth.dispose();
});

test("403 is not retried and tokens are never attached outside the configured API scope", async () => {
  const calls = [];
  const auth = client(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    calls.push(request);
    return request.url.endsWith("/login") ? json(tokens("one")) : json({}, 403);
  });
  await auth.login("TestUser", "fake");
  assert.equal((await auth.fetch(`${base}/v8/TEST/rules`)).status, 403);
  await auth.fetch("https://other.example/api");
  await auth.fetch("https://iris.example/unrelated");
  assert.equal(calls.length, 4);
  assert.equal(calls[2].headers.get("Authorization"), null);
  assert.equal(calls[3].headers.get("Authorization"), null);
  assert.throws(() => client(async () => json({}), { protectedUrls: ["https://other.example/api"] }), /origin/);
  auth.dispose();
});

test("failed refresh clears tokens and never loops on repeated unauthorized responses", async () => {
  const storage = memoryStorage();
  let apiCalls = 0;
  const auth = client(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.url.endsWith("/login")) return json(tokens("one"));
    if (request.url.endsWith("/refresh")) return json({}, 401);
    apiCalls++;
    return json({}, 401);
  }, { storage });
  await auth.login("TestUser", "fake");
  assert.equal((await auth.fetch(`${base}/v8/TEST/rules`)).status, 401);
  assert.equal(apiCalls, 1);
  assert.equal(storage.data.size, 0);
  assert.equal(auth.state.authenticated, false);
  auth.dispose();
});

test("logout sends the native endpoint, clears storage and cannot be undone by an in-flight refresh", async () => {
  const storage = memoryStorage();
  let complete;
  const auth = client(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.url.endsWith("/login")) return json(tokens("one"));
    if (request.url.endsWith("/refresh")) return new Promise(resolve => { complete = resolve; });
    assert.ok(request.url.endsWith("/logout"));
    assert.equal(await request.text(), "");
    return new Response(null, { status: 204 });
  }, { storage });
  await auth.login("TestUser", "fake");
  const pending = auth.refresh();
  await auth.logout();
  complete(json(tokens("late")));
  await assert.rejects(pending, AuthenticationError);
  assert.equal(storage.data.size, 0);
  assert.equal(auth.state.authenticated, false);
  auth.dispose();
});

test("stored refresh tokens initialize a session without reusing a password", async () => {
  const storage = memoryStorage();
  storage.setItem(`iris-auth:${base}`, JSON.stringify({ refreshToken: "saved-refresh" }));
  const calls = [];
  const auth = client(async (url, init) => { calls.push({ url, init }); return json(tokens("restored")); }, { storage });
  assert.equal(await auth.initialize(), true);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith("/refresh"));
  assert.deepEqual(JSON.parse(calls[0].init.body), { refresh_token: "saved-refresh" });
  auth.dispose();
});

test("401 sign-in callback is shared and each request retries only once", async () => {
  let prompted = 0;
  let apiCalls = 0;
  const auth = client(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.url.endsWith("/login")) return json(tokens("login"));
    apiCalls++;
    return request.headers.has("Authorization") ? json({ ok: true }) : json({}, 401);
  }, { onAuthenticationRequired: async () => { prompted++; await auth.login("TestUser", "fake"); return true; } });
  const responses = await Promise.all([auth.fetch(`${base}/v8/TEST/rules`), auth.fetch(`${base}/v8/TEST/transforms`)]);
  assert.ok(responses.every(response => response.ok));
  assert.equal(prompted, 1);
  assert.equal(apiCalls, 4);
  auth.dispose();
});

test("refresh scheduling uses server expiration and dispose cancels timers", async () => {
  let delay;
  let cleared = 0;
  const auth = client(async () => json({ ...tokens("timed"), exp: 110 }), {
    now: () => 100000, setTimer: (_callback, milliseconds) => { delay = milliseconds; return 7; }, clearTimer: () => { cleared++; }
  });
  await auth.login("TestUser", "fake");
  assert.equal(delay, 9000);
  auth.dispose();
  assert.equal(cleared, 1);
});

test("authentication configuration follows reverse-proxy/API origins and can be overridden centrally", () => {
  const api = resolveApiConfig({ apiBase: "/gateway/api/interop-editors/v8" }, "https://iris.example/editor/?%24NAMESPACE=TEST");
  const config = resolveAuthenticationConfig({}, api);
  assert.equal(config.authBase, "https://iris.example/gateway/api/interop-editors");
  assert.equal(config.sessionInfoUrl, "https://iris.example/gateway/api/interop-editors/info");
  assert.deepEqual(config.protectedUrls, [api.apiBase]);
  assert.equal(resolveAuthenticationConfig({ auth: { enabled: false } }, api).enabled, false);
});

test("the mock server supports native login, refresh, authenticated API requests and logout", async context => {
  const server = await startPreview({ port: 0 });
  context.after(() => new Promise(resolve => server.close(resolve)));
  const apiBase = `http://127.0.0.1:${server.address().port}/api/interop-editors/v8`;
  const auth = createAuthenticator({ authBase: apiBase.replace(/\/v8$/, ""), protectedUrls: [apiBase], setTimer: () => 1, clearTimer() {} });
  context.after(() => auth.dispose());
  assert.equal(await auth.initialize(), true);
  assert.equal(auth.state.user, "MockUser");
  const api = createInteropApi({ apiBase, namespace: "USER" }, { fetchImpl: auth.fetch });
  assert.ok((await api.listRules()).length);
  await auth.refresh();
  assert.equal(auth.state.authenticated, true);
  await auth.logout();
  assert.equal(auth.state.authenticated, false);
  await assert.rejects(auth.login("wrong", "fake"), error => error.status === 401);
  assert.equal(await auth.login("mock", "mock"), true);
});

test("reusable login UI clears password input and resolves only after a successful login", async () => {
  const nodes = [];
  const document = {
    createElement(tagName) {
      const attributes = new Map();
      const node = {
        tagName, children: [], events: new Map(),
        append(...children) { this.children.push(...children); },
        addEventListener(event, callback) { this.events.set(event, callback); },
        setAttribute(name, value) { attributes.set(name, value); },
        getAttribute(name) { return attributes.get(name); },
        focus() {}, remove() {}, showModal() { this.open = true; }, close() { this.open = false; }
      };
      nodes.push(node);
      return node;
    }
  };
  const calls = [];
  const state = { authenticated: false, user: "", mode: "anonymous" };
  const auth = {
    state,
    subscribe(callback) { callback(state); return () => {}; },
    login: async (user, password) => { calls.push({ user, password }); state.authenticated = true; },
    initialize: async () => false
  };
  const ui = createLoginController({ authenticator: auth, document });
  const pending = ui.requestLogin();
  const input = label => nodes.find(node => node.getAttribute("aria-label") === label);
  input("Username").value = "TestUser";
  input("Password").value = "fake-ui-password";
  const form = nodes.find(node => node.tagName === "form");
  const submitted = form.events.get("submit")({ preventDefault() {} });
  assert.equal(input("Password").value, "");
  await submitted;
  assert.equal(await pending, true);
  assert.deepEqual(calls, [{ user: "TestUser", password: "fake-ui-password" }]);
  assert.equal(ui.dialog.open, false);
  ui.destroy();
});

test("a repeated 401 after refresh is returned without another retry", async () => {
  let apiCalls = 0;
  let refreshes = 0;
  const auth = client(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.url.endsWith("/login")) return json(tokens("old"));
    if (request.url.endsWith("/refresh")) { refreshes++; return json(tokens("new")); }
    apiCalls++;
    return json({}, 401);
  });
  await auth.login("TestUser", "fake");
  assert.equal((await auth.fetch(`${base}/v8/TEST/rules`)).status, 401);
  assert.equal(apiCalls, 2);
  assert.equal(refreshes, 1);
  assert.equal(auth.state.authenticated, false);
  auth.dispose();
});
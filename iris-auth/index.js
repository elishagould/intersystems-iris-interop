export class AuthenticationError extends Error {
  constructor(message = "Authentication is required.", status = 401) {
    super(message);
    this.name = "AuthenticationError";
    this.status = status;
  }
}

export function createAuthenticator({
  authBase, protectedUrls = [authBase], sessionInfoUrl,
  endpoints = {}, fetchImpl = globalThis.fetch, storage,
  credentials = "same-origin", onAuthenticationRequired,
  refreshCushion = 1000, now = Date.now,
  setTimer = setTimeout, clearTimer = clearTimeout
}) {
  const base = new URL(authBase);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new TypeError("Configure a valid HTTP(S) authentication base.");
  const baseURL = base.href.replace(/\/+$/, "");
  const routes = Object.fromEntries(Object.entries({ login: "login", refresh: "refresh", logout: "logout", revoke: "revoke", ...endpoints })
    .map(([name, path]) => {
      const url = new URL(path, `${baseURL}/`);
      if (url.origin !== base.origin || url.username || url.password) throw new TypeError("Authentication endpoints must use the authentication origin.");
      return [name, url.href];
    }));
  const infoURL = sessionInfoUrl ? new URL(sessionInfoUrl, `${baseURL}/`).href : `${baseURL}/info`;
  if (new URL(infoURL).origin !== base.origin) throw new TypeError("Session info must use the authentication origin.");
  const scopes = protectedUrls.map(value => {
    const url = new URL(value, `${baseURL}/`);
    if (url.origin !== base.origin || url.username || url.password) throw new TypeError("Protected APIs must use the authentication origin.");
    return { origin: url.origin, path: url.pathname.replace(/\/+$/, "") };
  });
  const storageKey = `iris-auth:${baseURL}`;
  const listeners = new Set();
  let token = null;
  let user = "";
  let authenticated = false;
  let mode = "anonymous";
  let refreshPromise;
  let signInPromise;
  let timer;
  let epoch = 0;
  let disposed = false;

  function state() { return { authenticated, user, mode }; }
  function notify() { for (const listener of listeners) listener(state()); }
  function cancelTimer() { if (timer !== undefined) clearTimer(timer); timer = undefined; }
  function persist() {
    try { if (token) storage?.setItem(storageKey, JSON.stringify(token)); else storage?.removeItem(storageKey); } catch {}
  }
  function clear() {
    epoch++;
    cancelTimer();
    token = null;
    user = "";
    authenticated = false;
    mode = "anonymous";
    persist();
    notify();
  }
  function accept(data) {
    if (typeof data?.access_token !== "string" || !data.access_token || typeof data?.refresh_token !== "string" || !data.refresh_token) {
      throw new AuthenticationError("The server did not return valid authentication tokens.");
    }
    epoch++;
    cancelTimer();
    token = { accessToken: data.access_token, refreshToken: data.refresh_token, user: String(data.sub ?? ""), expiresAt: Number(data.exp) * 1000 || null };
    user = token.user;
    authenticated = true;
    mode = "token";
    persist();
    notify();
    if (token.expiresAt) {
      const delay = Math.max(1000, token.expiresAt - now() - refreshCushion);
      timer = setTimer(() => { refresh().catch(() => {}); }, Math.min(delay, 2147483647));
      timer?.unref?.();
    }
  }

  async function authRequest(url, payload, { method = "POST", signal, bearer = false } = {}) {
    const headers = { Accept: "application/json" };
    if (bearer && token?.accessToken) headers.Authorization = `Bearer ${token.accessToken}`;
    if (payload !== undefined && payload !== null) headers["Content-Type"] = "application/json";
    const response = await fetchImpl(url, { method, headers, credentials, signal, redirect: "error", body: method === "GET" ? undefined : payload == null ? null : JSON.stringify(payload) });
    if (!response.ok) throw new AuthenticationError(response.status === 403 ? "Access denied." : "Authentication request failed.", response.status);
    if (response.status === 204) return null;
    return response.json();
  }

  async function session(signal) {
    const version = epoch;
    const result = await authRequest(infoURL, undefined, { method: "GET", signal });
    if (disposed || version !== epoch || signal?.aborted) throw new AuthenticationError("Authentication was cancelled.");
    if (!result?.username) throw new AuthenticationError();
    epoch++;
    cancelTimer();
    token = null;
    user = String(result.username);
    authenticated = true;
    mode = "session";
    persist();
    notify();
    return true;
  }

  async function login(username, password, { signal } = {}) {
    if (disposed) throw new AuthenticationError("Authenticator has been disposed.");
    const explicit = username !== undefined || password !== undefined;
    if (explicit && (!username?.trim() || !password)) throw new TypeError("Enter a username and password.");
    const version = epoch;
    try {
      const result = await authRequest(routes.login, explicit ? { user: username.trim(), password } : null, { signal });
      if (disposed || version !== epoch || signal?.aborted) throw new AuthenticationError("Authentication was cancelled.");
      accept(result);
      return true;
    } catch (error) {
      if (signal?.aborted || disposed || version !== epoch) throw error;
      try { return await session(signal); }
      catch { if (!disposed && version === epoch) clear(); throw error; }
    }
  }

  async function refresh() {
    if (refreshPromise) return refreshPromise;
    if (!token?.refreshToken || disposed) throw new AuthenticationError();
    const version = epoch;
    const refreshToken = token.refreshToken;
    refreshPromise = (async () => {
      try {
        const result = await authRequest(routes.refresh, { refresh_token: refreshToken });
        if (disposed || version !== epoch) throw new AuthenticationError("Authentication was cancelled.");
        accept(result);
        return true;
      } catch (error) { if (version === epoch && !disposed) clear(); throw error; }
      finally { refreshPromise = undefined; }
    })();
    return refreshPromise;
  }

  async function initialize({ signal } = {}) {
    if (disposed) throw new AuthenticationError("Authenticator has been disposed.");
    try {
      const saved = JSON.parse(storage?.getItem(storageKey) ?? "null");
      if (saved?.refreshToken && typeof saved.refreshToken === "string") token = saved;
    } catch { clear(); }
    if (token?.refreshToken) {
      try { await refresh(); return true; } catch (error) { if (signal?.aborted) throw error; }
    }
    try { return await login(undefined, undefined, { signal }); }
    catch (error) {
      if (signal?.aborted || !(error instanceof AuthenticationError) || ![401, 403].includes(error.status)) throw error;
      return false;
    }
  }

  function protectedRequest(url) {
    return scopes.some(scope => url.origin === scope.origin && (url.pathname === scope.path || url.pathname.startsWith(`${scope.path}/`)));
  }

  async function authenticatedFetch(input, init) {
    const request = new Request(input, { ...init, credentials });
    const url = new URL(request.url);
    if (!protectedRequest(url) || Object.values(routes).includes(url.href)) return fetchImpl(input, init);
    if (disposed) throw new AuthenticationError("Authenticator has been disposed.");
    if (refreshPromise) { try { await refreshPromise; } catch {} }
    const send = () => {
      const headers = new Headers(request.headers);
      if (token?.accessToken) headers.set("Authorization", `Bearer ${token.accessToken}`);
      return fetchImpl(new Request(request.clone(), { headers, redirect: "error" }));
    };
    const sentToken = token?.accessToken;
    const response = await send();
    if (response.status !== 401) return response;
    let restored = token?.accessToken && token.accessToken !== sentToken;
    if (!restored && token?.refreshToken) {
      try { restored = await refresh(); } catch { restored = false; }
    }
    if (!restored) {
      clear();
      if (!onAuthenticationRequired) return response;
      signInPromise ??= Promise.resolve().then(() => onAuthenticationRequired()).finally(() => { signInPromise = undefined; });
      await signInPromise;
      restored = authenticated;
    }
    if (!restored || request.signal.aborted) return response;
    const retry = await send();
    if (retry.status === 401) clear();
    return retry;
  }

  async function endSession(endpoint) {
    const accessToken = token?.accessToken;
    clear();
    try {
      const headers = { Accept: "application/json" };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      const response = await fetchImpl(endpoint, { method: "POST", headers, body: null, credentials, redirect: "error" });
      if (!response.ok) throw new AuthenticationError("Session could not be ended on the server.", response.status);
    } finally { clear(); }
  }

  return {
    initialize, login, refresh, fetch: authenticatedFetch,
    logout: () => endSession(routes.logout), revoke: () => endSession(routes.revoke),
    get state() { return state(); },
    subscribe(listener) { listeners.add(listener); listener(state()); return () => listeners.delete(listener); },
    dispose() { disposed = true; epoch++; cancelTimer(); listeners.clear(); token = null; user = ""; mode = "anonymous"; authenticated = false; }
  };
}
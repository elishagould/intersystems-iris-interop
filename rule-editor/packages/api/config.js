export function resolveApiConfig(settings, pageURL) {
  const page = new URL(pageURL);
  const apiBase = new URL(settings.apiBase, page.origin);
  if (!settings.apiBase || !["http:", "https:"].includes(apiBase.protocol) || apiBase.search || apiBase.hash) {
    throw new TypeError("Configure a valid HTTP(S) apiBase without a query or fragment.");
  }
  const namespace = (page.searchParams.get("$NAMESPACE") ?? settings.defaultNamespace ?? "").trim();
  if (!namespace) throw new TypeError("$NAMESPACE is required.");
  return {
    apiBase: apiBase.href.replace(/\/+$/, ""),
    namespace,
    rule: page.searchParams.get("rule")?.trim() || null
  };
}

export function resolveAuthenticationConfig(settings, apiConfig) {
  const auth = settings.auth ?? {};
  const authBase = new URL(auth.baseUrl ?? apiConfig.apiBase.replace(/\/v\d+\/?$/, ""), apiConfig.apiBase).href.replace(/\/+$/, "");
  return {
    enabled: auth.enabled !== false,
    authBase,
    sessionInfoUrl: new URL(auth.sessionInfoUrl ?? "info", `${authBase}/`).href,
    protectedUrls: [apiConfig.apiBase],
    endpoints: auth.endpoints,
    refreshCushion: auth.refreshCushion ?? 1000
  };
}
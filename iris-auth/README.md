# @intersystems/iris-auth

Standalone browser authenticator for the IRIS token/session protocol used by the
native interop editor. No Angular, editor, rule model or third-party dependency is
required. Applications inject their protected API scopes and their own UI policy.

## Use

```javascript
import { createAuthenticator } from "@intersystems/iris-auth";
import { createLoginController } from "@intersystems/iris-auth/login";

let login;
const authenticator = createAuthenticator({
  authBase: `${location.origin}/api/interop-editors`,
  protectedUrls: [`${location.origin}/api/interop-editors/v8`],
  storage: sessionStorage,
  onAuthenticationRequired: () => login.requestLogin()
});
login = createLoginController({ authenticator, document });
document.body.append(login.account, login.dialog);
await login.ensureAuthenticated();
const response = await authenticator.fetch(
  `${location.origin}/api/interop-editors/v8/USER/rules`
);
```

Include `@intersystems/iris-auth/index.css` for the optional login/account UI. Without a
bundler, serve the package files and use their relative URLs instead of bare npm
imports. A custom UI can call `login`, `logout`, `revoke`, `initialize` and
`subscribe` directly and does not need `login.js` or the stylesheet.

## Protocol

- POST `login`: `{user,password}` for credentials, or an empty POST to reuse an existing
  server session. On failure, GET `info` can identify a portal `username`.
- Successful token responses contain `access_token`, `refresh_token`, `sub`, and
  optional `exp`/`iat` timestamps.
- POST `refresh`: `{refresh_token}`. Concurrent refreshes share one request.
- POST `logout` and `revoke`: empty body, with the current bearer token when present.
- Authenticated fetch attaches bearer tokens only to configured origin/path
  scopes. A 401 can refresh or request sign-in, then replay the request once;
  403 does not trigger a retry. Request bodies and AbortSignals are retained.

The endpoint fragments, session-info URL, storage, fetch implementation and
refresh timer hooks are injectable. Defaults use same-origin credentials and a
one-second refresh cushion. Redirects on authenticated requests are rejected.
Only APIs accepting this IRIS token protocol should be configured as protected.
The package does not validate server-side authorization or JWT signatures; IRIS
remains responsible for both, and HTTPS is required in production.

Storage is memory-only unless an implementation is supplied. Optional session
storage is keyed by the authentication base URL, never stores passwords and is
cleared on logout/failed refresh. Session-storage bearer tokens remain accessible
to same-origin scripts; use an appropriate CSP and XSS protections. There is no
automatic local-storage persistence, credential logging or insecure TLS bypass.
`state`/`subscribe` expose user/authentication status, not tokens.

`createLoginController` accepts `onSignedIn` and `onSignedOut` host callbacks.
The host should hide protected data when unauthenticated and clear any sensitive
application state on sign-out/user changes. Dialog passwords are cleared after
submission and close. Call the controller's `destroy` and authenticator's
`dispose` when removing the application.

## Distribute

From this directory:

```powershell
npm pack
```

The resulting `intersystems-iris-auth-0.1.0.tgz` contains the core, optional login UI and
stylesheet. Other apps can install it as a normal package or use a local
`file:` dependency. The rule-editor-v2 build copies only these runtime files;
no server authentication implementation or mock is shipped in this package.

Repository verification is in the rule-editor-v2 authentication tests, including
native payloads, refresh races, request replay, scope restrictions and mock HTTP
integration. These tests use synthetic credentials/tokens only.
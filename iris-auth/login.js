import { AuthenticationError } from "./index.js";

export function createLoginController({ authenticator, document, onSignedIn = () => {}, onSignedOut = () => {} }) {
  const account = document.createElement("div");
  account.className = "iris-auth-account";
  const user = document.createElement("span");
  const action = document.createElement("button");
  action.type = "button";
  const accountError = document.createElement("span");
  accountError.className = "iris-auth-error";
  accountError.setAttribute("role", "status");
  account.append(user, action, accountError);

  const dialog = document.createElement("dialog");
  dialog.className = "iris-auth-dialog";
  dialog.setAttribute("aria-label", "Sign in");
  const form = document.createElement("form");
  const heading = document.createElement("h2");
  heading.textContent = "Sign In";
  function field(text, type, autocomplete) {
    const label = document.createElement("label");
    const caption = document.createElement("span");
    caption.textContent = text;
    const input = document.createElement("input");
    input.type = type;
    input.autocomplete = autocomplete;
    input.required = true;
    input.setAttribute("aria-label", text);
    label.append(caption, input);
    form.append(label);
    return input;
  }
  form.append(heading);
  const username = field("Username", "text", "username");
  const password = field("Password", "password", "current-password");
  const error = document.createElement("p");
  error.className = "iris-auth-error";
  error.setAttribute("role", "alert");
  error.hidden = true;
  const footer = document.createElement("div");
  footer.className = "iris-auth-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "Sign In";
  footer.append(cancel, submit);
  form.append(error, footer);
  dialog.append(form);
  let pending;
  let attempt;
  let disposed = false;

  function finish(result) {
    attempt?.abort();
    password.value = "";
    if (dialog.open) dialog.close();
    pending?.resolve(result);
    pending = null;
  }
  function requestLogin() {
    if (disposed) return Promise.resolve(false);
    if (authenticator.state.authenticated) return Promise.resolve(true);
    if (pending) return pending.promise;
    let resolve;
    const promise = new Promise(callback => { resolve = callback; });
    pending = { promise, resolve };
    error.hidden = true;
    password.value = "";
    submit.disabled = false;
    username.disabled = password.disabled = false;
    dialog.showModal();
    username.focus();
    return promise;
  }
  cancel.addEventListener("click", () => finish(false));
  dialog.addEventListener("cancel", event => { event.preventDefault(); finish(false); });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (submit.disabled) return;
    attempt = new AbortController();
    const typedPassword = password.value;
    password.value = "";
    submit.disabled = true;
    username.disabled = password.disabled = true;
    error.hidden = true;
    try {
      await authenticator.login(username.value, typedPassword, { signal: attempt.signal });
      if (disposed || attempt.signal.aborted) return;
      finish(true);
      onSignedIn();
    } catch (failure) {
      if (!disposed && !attempt.signal.aborted) {
        error.textContent = failure.status === 401 ? "Invalid username or password." : failure.status === 403 ? "Access denied." : "Sign-in is unavailable. Try again.";
        error.hidden = false;
      }
    } finally {
      if (!disposed) { submit.disabled = false; username.disabled = password.disabled = false; }
    }
  });
  action.addEventListener("click", async () => {
    accountError.textContent = "";
    try {
      if (authenticator.state.authenticated) { await authenticator.logout(); onSignedOut(); }
      else await requestLogin();
    } catch { accountError.textContent = "The server session could not be ended."; }
  });
  const unsubscribe = authenticator.subscribe(state => {
    user.textContent = state.authenticated ? state.user : "";
    action.textContent = state.authenticated ? "Sign Out" : "Sign In";
  });
  return {
    account, dialog, requestLogin,
    async ensureAuthenticated() {
      if (await authenticator.initialize()) return true;
      if (await requestLogin()) return true;
      throw new AuthenticationError("Sign-in was cancelled.");
    },
    destroy() { disposed = true; finish(false); unsubscribe(); account.remove(); dialog.remove(); }
  };
}
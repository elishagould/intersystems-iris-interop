import { RuleEditorState } from "./packages/editor/model.js";
import { mountRuleEditor } from "./packages/editor/index.js";
import { resolveBusinessRuleName } from "./packages/editor/rule-selection.js";
import { resolveApiConfig, resolveAuthenticationConfig } from "./packages/api/config.js";
import { createInteropApi, loadRuleResources } from "./packages/api/client.js";
import { createNewRuleDialog } from "./packages/editor/new-view.js";
import { createNewRuleDefinition, createRuleExport } from "./packages/editor/save.js";
import { createAuthenticator } from "./node_modules/@intersystems/iris-auth/index.js";
import { createLoginController } from "./node_modules/@intersystems/iris-auth/login.js";

const preview = document.querySelector("#preview");
const businessRuleInput = document.querySelector("#business-rule");
const businessRuleNames = document.querySelector("#business-rule-names");
const status = document.querySelector("#status");
const newRuleButton = document.querySelector("#new-business-rule");
const openRuleButton = document.querySelector("#open-business-rule");
let schema;
let mountedEditor;
let request;
let editorState;
let ruleNames = [];
let openedRuleName;
let pendingRuleName;
let api;
let apiConfig;
let ruleTypes = [];
let ruleMetadata;
let authenticator;
let loginController;
let startupFailed = false;

function render() {
  mountedEditor?.destroy();
  mountedEditor = null;
  preview.replaceChildren();
  if (editorState) {
    mountedEditor = mountRuleEditor(preview, editorState, {
      ruleName: openedRuleName,
      saveContainer: document.querySelector("#save-actions"),
      onSave: persistBusinessRule,
      onSaved: installSavedRule,
      loadConfigItems: signal => api.configItems(signal),
      loadTransforms: signal => api.transforms(signal),
      loadMessageClasses: signal => api.messageClasses(signal),
      loadConstraintOptions: (messageClass, signal) => api.constraintOptions(ruleMetadata.assistClass, messageClass, signal)
    });
  }
}

async function persistBusinessRule(output, signal) {
  if (output.method === "PUT") await api.updateRule(output.name, output.payload, signal);
  else await api.createRule(output.name, output.payload, signal);
  try { return await loadRuleResources(api, output.name, ruleTypes, signal); }
  catch (error) { throw new Error(`Write completed, but the rule could not be reloaded. Refresh before retrying. ${error.message}`); }
}

function installSavedRule(resources, output) {
  request?.abort();
  pendingRuleName = undefined;
  schema = resources.assistant;
  ruleMetadata = resources;
  editorState = new RuleEditorState(resources.definition, schema);
  openedRuleName = output.name;
  document.querySelector("#current-rule-name").textContent = openedRuleName;
  businessRuleInput.value = openedRuleName;
  businessRuleInput.setCustomValidity("");
  businessRuleInput.removeAttribute("aria-invalid");
  if (!ruleNames.includes(openedRuleName)) {
    ruleNames.push(openedRuleName);
    const option = document.createElement("option");
    option.value = openedRuleName;
    option.textContent = openedRuleName;
    businessRuleNames.append(option);
  }
  const url = new URL(window.location.href);
  url.searchParams.set("rule", openedRuleName);
  window.history.replaceState(null, "", url);
  status.hidden = true;
  preview.setAttribute("aria-busy", "false");
  render();
}

async function createBusinessRule(details, signal) {
  const [assistant] = await Promise.all([
    api.assistant(details.ruleType.name, signal), api.context(details.contextClass, signal)
  ]);
  const definition = createNewRuleDefinition(assistant, details);
  return persistBusinessRule(createRuleExport(definition, { name: details.name, mode: "new" }), signal);
}

async function loadBusinessRule() {
  const name = resolveBusinessRuleName(businessRuleInput.value, ruleNames);
  if (!name) {
    businessRuleInput.setCustomValidity("Choose a valid business rule name from the list.");
    businessRuleInput.setAttribute("aria-invalid", "true");
    return;
  }
  businessRuleInput.setCustomValidity("");
  businessRuleInput.removeAttribute("aria-invalid");
  businessRuleInput.value = name;
  if (pendingRuleName === name) return;
  if (openedRuleName === name && editorState) {
    request?.abort();
    pendingRuleName = undefined;
    status.hidden = true;
    preview.setAttribute("aria-busy", "false");
    return;
  }
  request?.abort();
  request = new AbortController();
  pendingRuleName = name;
  const { signal } = request;
  preview.setAttribute("aria-busy", "true");
  status.hidden = false;
  status.textContent = "Loading business rule...";
  try {
    const resources = await loadRuleResources(api, name, ruleTypes, signal);
    if (signal.aborted) return;
    schema = resources.assistant;
    ruleMetadata = resources;
    editorState = new RuleEditorState(resources.definition, schema);
    openedRuleName = name;
    document.querySelector("#current-rule-name").textContent = openedRuleName;
    render();
    status.hidden = true;
  } catch (error) {
    if (signal.aborted || error.name === "AbortError") return;
    status.textContent = error.message;
  } finally {
    if (!signal.aborted) {
      pendingRuleName = undefined;
      preview.setAttribute("aria-busy", "false");
    }
  }
}

try {
  const configResponse = await fetch(new URL("./config.json", import.meta.url), { cache: "no-store" });
  if (!configResponse.ok) throw new Error(`Could not load API configuration (${configResponse.status}).`);
  const settings = await configResponse.json();
  apiConfig = resolveApiConfig(settings, window.location.href);
  const authConfig = resolveAuthenticationConfig(settings, apiConfig);
  if (authConfig.enabled) {
    let storage;
    try { storage = window.sessionStorage; } catch {}
    authenticator = createAuthenticator({
      ...authConfig, storage, fetchImpl: window.fetch.bind(window),
      onAuthenticationRequired: () => loginController.requestLogin()
    });
    loginController = createLoginController({
      authenticator, document, onSignedIn() { if (startupFailed) window.location.reload(); },
      onSignedOut() { window.location.reload(); }
    });
    document.querySelector("#authentication-status").append(loginController.account);
    document.body.append(loginController.dialog);
    let principal;
    authenticator.subscribe(state => {
      const changedUser = state.authenticated && principal && principal !== state.user;
      preview.hidden = !state.authenticated || !!changedUser;
      businessRuleInput.disabled = !state.authenticated || !ruleNames.length;
      openRuleButton.disabled = !state.authenticated || !ruleNames.length;
      newRuleButton.disabled = !state.authenticated || !ruleTypes.length;
      if (changedUser) { window.location.reload(); return; }
      if (state.authenticated) principal = state.user;
    });
    api = createInteropApi(apiConfig, { fetchImpl: authenticator.fetch });
    await loginController.ensureAuthenticated();
    window.addEventListener("pagehide", event => {
      if (!event.persisted) { loginController.destroy(); authenticator.dispose(); }
    }, { once: true });
  } else api = createInteropApi(apiConfig);
  document.querySelector("#api-environment").textContent = window.location.host;
  document.querySelector("#api-namespace").textContent = apiConfig.namespace;
  const [names, types] = await Promise.all([
    api.listRules(), api.ruleTypes()
  ]);
  if (!Array.isArray(names) || names.some(name => typeof name !== "string") || !Array.isArray(types)) {
    throw new TypeError("Expected business rule names and rule types to be arrays.");
  }
  ruleTypes = types;
  const formButton = (label, icon, action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "editor-icon-button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.append(window.lucide.createElement(window.lucide[icon], { width: 18, height: 18, "aria-hidden": "true" }));
    button.addEventListener("click", action);
    return button;
  };
  const newDialog = createNewRuleDialog(document, {
    getRuleTypes: () => ruleTypes, getSourceName: () => openedRuleName ?? "", button: formButton,
    loadClassPackages: signal => api.classPackages(signal),
    onCreate: createBusinessRule, onCreated: installSavedRule
  });
  document.body.append(newDialog.element);
  newRuleButton.prepend(window.lucide.createElement(window.lucide.FilePlus2, { width: 17, height: 17, "aria-hidden": "true" }));
  newRuleButton.disabled = !types.length;
  newRuleButton.addEventListener("click", () => newDialog.open());
  openRuleButton.disabled = !names.length;
  openRuleButton.addEventListener("click", () => { loadBusinessRule(); businessRuleInput.reportValidity(); });
  ruleNames = names;
  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    businessRuleNames.append(option);
  }
  businessRuleInput.disabled = false;
  businessRuleInput.value = apiConfig.rule ?? names[0] ?? "";
  businessRuleInput.addEventListener("change", loadBusinessRule);
  businessRuleInput.addEventListener("input", () => {
    if (pendingRuleName) {
      request?.abort();
      pendingRuleName = undefined;
      preview.setAttribute("aria-busy", "false");
      status.hidden = true;
    }
    businessRuleInput.setCustomValidity("");
    businessRuleInput.removeAttribute("aria-invalid");
  });
  businessRuleInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      loadBusinessRule();
      businessRuleInput.reportValidity();
    }
  });
  if (apiConfig.rule && !resolveBusinessRuleName(apiConfig.rule, names)) {
    status.textContent = `Unknown business rule: ${apiConfig.rule}`;
    preview.setAttribute("aria-busy", "false");
  } else if (names.length) await loadBusinessRule();
  else { status.textContent = "No business rules available."; preview.setAttribute("aria-busy", "false"); }
} catch (error) {
  startupFailed = true;
  status.textContent = error.message;
  preview.setAttribute("aria-busy", "false");
}
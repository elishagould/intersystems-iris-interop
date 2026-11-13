# Rule Editor

Standalone HTML building blocks and an in-memory sample editor. See the
[repository setup guide](../README.md) for VS Code debugging, build tasks and
GitHub Actions packaging, and the [IRIS installation guide](iris/README.md)
for IPM/ZPM and standalone installation.

## Local Preview

Requires Node.js 20 or newer. Install the local Lucide and Chevrotain dependencies once.
No IRIS connection, build or deployment is needed for the mock preview.

```powershell
npm install
npm start
```

Open the URL printed by the server (normally http://127.0.0.1:5173/). An occupied
port is skipped automatically. To choose another starting port:

```powershell
npm start -- --port 5180
```

## API Configuration

All browser endpoints are defined in `packages/api/client.js`. Runtime
`config.json` sets `apiBase` (default `/api/interop-editors/v8`) and the local
preview's `defaultNamespace` (default `USER`). The page's `$NAMESPACE`
parameter overrides that fallback; `rule` selects the initial business rule:

```text
http://127.0.0.1:5173/?$NAMESPACE=USER&rule=RouterRule.TestRouterRules.TestRouterRulesSub
```

Every route below is prefixed by `{apiBase}/{NAMESPACE}`:

| Resource | Method And Path |
| --- | --- |
| Rule names | GET `/rules` |
| Rule definition | GET, PUT, POST `/rules/{rule}` |
| Rule types | GET `/rules/types` |
| Context | GET `/rules/context/{contextClass}` |
| RuleAssist | GET `/rules/types/{RuleAssistClass}` |
| Constraint options | POST `/rules/types/{RuleAssistClass}/constraint-options` |
| Message classes | GET `/bpl/message-classes` |
| Config items | GET `/config-items` |
| Class packages | GET `/class-packages` |
| Transforms | GET `/transforms` |

Rule types are an array of entries with `name` and `contextClass`. The selected
rule's `assistClass` and `context` determine its resource classes; an unambiguous
matching type supplies missing class metadata. Context and RuleAssist data are
loaded for each rule rather than fixed to the HL7 example. Constraint options
currently POST `{ "messageClass": "EnsLib.HL7.Message" }`; this body shape is
isolated in the client for adjustment when the real server contract is confirmed.
Requests use same-origin session credentials and AbortSignal cancellation.

## Authentication

The reusable `@intersystems/iris-auth` package lives in the sibling
`../iris-auth` folder and is installed through a local file dependency.
It mirrors the native editor's token/session protocol without loading the native
Angular application. V2 initializes it before API requests and passes its scoped
authenticated fetch to the API client.

`config.json` centrally configures `auth.enabled` and `auth.refreshCushion`.
Optional `auth.baseUrl`, `auth.sessionInfoUrl` and `auth.endpoints` override the
native login/refresh/logout/revoke routes. By default the authentication base is
the configured v8 API base without `/v8`, and session info is its `/info` route,
so reverse-proxy prefixes follow the data API. Protected API/auth origins must
match. Do not put usernames, passwords or tokens into configuration.

The package first restores/refreshes a stored token or tries an existing server
session, falling back to a username/password dialog when necessary. Tokens use
API-scoped sessionStorage, passwords are never persisted, bearer headers are
restricted to the API path, and 401 handling refreshes/retries once. 403 remains
an authorization error. Reauthentication does not reload unsaved rule edits;
explicit sign-out hides protected content and reloads the application state.

The optional account/sign-in UI belongs to the package and can be reused by other
apps. Run `npm pack` from the package folder to distribute it independently.
The static build includes its installed runtime files automatically.

`npm start` serves mock routes at those exact paths, backed by `mock-data/`.
The browser never reads fixtures directly. Only namespaces with their own data
directory are available; the demo namespace is `USER`. Unknown namespaces return
404 instead of silently inheriting demo rules. Rule types and class packages
come from their own JSON response files. Edit `mock-data/USER/class-packages.json`
to supply the demo package suggestions.
Constraint POST is read-only. Rule PUT updates an existing rule; rule POST
creates a new name. Duplicate names, stale timestamps and read-only updates are
rejected. Restarting the preview discards mock writes; sample files never change.
The preview also mocks native auth routes. It starts with a synthetic portal
session; after sign-out, use the public test credentials `mock` / `mock`.
Mock authentication is for protocol testing only and does not protect the mock
dataset. Never deploy the mock servers or those test credentials as real auth.

Use `npm start -- --live` to disable mock routes. This only serves static assets;
it is not a reverse proxy. Configure an accessible API base, or deploy behind the
same origin as the API. Cross-origin hosting requires the server's CORS setup.

## Mock Data Layout

The recommended base path is `mock-data/`, with namespace as its first directory.
Resource paths mirror the live API beneath `{apiBase}/{NAMESPACE}`. Individual
resources use `<name>.json`; collection responses use `index.json`:

```text
mock-data/
  USER/
    config-items.json
    transforms.json
    class-packages.json
    bpl/message-classes.json
    rules/
      index.json
      RouterRule.TestRouterRules.TestRouterRules.json
      RouterRule.TestRouterRules.TestRouterRulesSub.json
      context/EnsLib.HL7.MsgRouter.RoutingEngine.json
      types/
        index.json
        EnsLib.HL7.MsgRouter.RuleAssist.json
        EnsLib.HL7.MsgRouter.RuleAssist/
          constraint-options/
            index.json
            EnsLib.HL7.Message.json
    sourcecontrol/
      menus.json
      status.json
```

For example, GET `/api/interop-editors/v8/USER/bpl/message-classes` reads
`mock-data/USER/bpl/message-classes.json`, and GET `/.../USER/rules/types` reads
`mock-data/USER/rules/types/index.json`. Constraint-option POST uses the selected
message class to find `constraint-options/<messageClass>.json`, falling back to
that assistant's `constraint-options/index.json`. Both included HL7 assistant
types have their own options directories.

Add another namespace by creating its corresponding directory and response
files. Rule writes remain in-memory and namespace-local. Class names inside the
fixture payloads are preserved; their package names are not namespace settings.
The old GET/PUT sample directory is retired. The historical PUT request capture
is retained separately at
`tests/fixtures/USER/rules/RouterRule.TestRouterRules.TestRouterRulesSub.put.json`
for serializer validation, not as a live mock response. All fixture files use
the `.json` extension, and the static build excludes the whole mock-data tree.

## Static Web Build

```powershell
npm run build
```

The generated `dist/` contains the browser runtime, local icon/parser bundles and
`config.json`, but no sample data, mock server or tests. Host these assets under
any static application directory and configure `dist/config.json` for that
environment. The build emits the parser bundle as `.js` and rewrites its deployed
import because some IRIS web servers serve `.mjs` as `application/octet-stream`,
which blocks browser module loading. Deploy the build output, not raw source.
Serve `.js` as JavaScript and `.json` as JSON; preserve the directory layout for
relative imports. The build does not deploy to IRIS; rule
persistence uses the configured API. Do not copy the mock server into a live API.
Remove `defaultNamespace` from the live config to require an explicit `$NAMESPACE`
parameter instead of using the preview fallback.

The Editor view adds a fixed toolbar above a scrollable rule tree. It supports
opening a rule through the searchable Business Rules field in the header.
Choose a suggested name or type a full name and press Enter. Only an exact name
from the returned business-rule list opens; case and surrounding whitespace are
normalized to the listed spelling. Partial, unknown and empty names leave the
current editor unchanged. Re-selecting the open rule does not discard its edits.

The editor supports
selected-value editing, schema-aware Add, subtree Remove, undo/redo and a shared
expression dialog (`fx`). Nodes in ordered sibling lists, including rule actions
and conditions, can move up or down. Consecutive typing is grouped into one undo
step. Collection-valued properties are read-only in the toolbar; constraint
arrays can be edited in their popup.

Double-clicking condition, constraint, target, transform, ruleName or value opens
the same dialog used by the expression button, specialized for that property.
Conditions have a selectable expression tree with up/down, operator (`op`),
function (`fx`), add and remove controls. Clicking an operator or function shows
choices from RuleAssist; function parameters also use its metadata. Other scalar
properties use the existing multiline value editor, and constraints use a
metadata-driven form. Cancel does not change the rule; OK applies the
whole popup edit as one undo step.

Target specializes that same popup with a multi-entry picker. It loads
the configured `/config-items` API on opening and shows case-insensitive matching names
while typing. Each selected entry has a remove button. Enter accepts the typed
text exactly (trimmed), unless an option was explicitly highlighted with the
arrow keys; clicking a suggestion also adds it. Duplicate entries are ignored.
OK includes pending typed text and stores all entries as the existing
comma-separated target string. Cancel leaves the original target untouched.

`mountRuleEditor(container, state, { loadConfigItems })` accepts an asynchronous
loader receiving an AbortSignal and returning `{ configItems: ["Name.Process"] }`.
The app supplies the API client loader, using the same routes in mock and live
mode. If loading fails, manually typed targets
remain available. Closing or replacing the picker cancels its request.

Transform uses the same removable-entry picker and keyboard behavior, loading
suggestions from the configured `/transforms` API. The response is
`{ transforms: ["Package.Transform"] }`. Matching is case-insensitive, typed
names are accepted with Enter, and selected entries are stored as a
comma-separated transform string. Supply `loadTransforms` alongside
`loadConfigItems` when mounting the editor to use a different data source.

Constraints load the configured `/bpl/message-classes` API and show a section selector such as
`request.persistentVDocs`, followed by the classes in that section. Selecting a
class calls `loadConstraintOptions(messageClass, signal)`, which POSTs to the
current RuleAssist's constraint-options endpoint. The mock returns the HL7
fixture for `EnsLib.HL7.Message` and the generic fixture for other classes.
Neither mock request changes the fixtures.

The returned `constraintOptions` determine each field's label, control and
choices. A `configItem` flag of `1` loads choices from `config-items`; other
fields use their returned `options`. `select multiple` creates a multi-select,
stored in the existing comma-separated constraint value. Message class is stored
as `msgClass`. Existing values not present in the test lists and unrecognized
constraint records are preserved. Changing classes aborts older requests and
prevents stale responses from replacing the current form.

Supply `loadMessageClasses(signal)` and
`loadConstraintOptions(messageClass, signal)` alongside the other editor loaders.
Each returns its parsed response object. Apply is unavailable while options are
loading or after a request error; Cancel always leaves the rule unchanged.

The editor uses API-provided data. The top-level ruleSet always remains expanded and has no collapse
control. Other branches with children have circular minus/plus controls at the tree
line junction: minus hides the descendants, plus reveals them. The editor also
has Expand All and Collapse All commands. Hidden rows do not contribute connector
lines, and folding never changes the rule data or creates an undo entry. Nested
folds remain closed when a parent is reopened; normal value edits retain them.

Edits are in memory only; reloading the page or opening another business rule
discards them. The mock server permits GET/HEAD and the read-only constraint
POST; it cannot save rules or modify fixtures. Refresh after source changes.

## Save And New

Save and Save As open a JSON preview with a submit button and optional Download
JSON. Save sends PUT to `{apiBase}/{NAMESPACE}/rules/{rule}`. Save As has separate
Package and Name fields and POSTs to the newly qualified name on the same route.
The open rule and name list switch to the saved copy only after a successful
write and reload. API failures keep the dialog and existing edits intact; a
successful reload starts a fresh undo history with the server's saved version.

The header's New button is also available when there are no existing rules. It
accepts Package, Name, Description, Rule Type and Context class. Package is an
editable autocomplete field populated from GET
`{apiBase}/{NAMESPACE}/class-packages` whenever New opens. The response is
`{ "classPackages": ["RouterRule", "RouterRule.TestRouterRules"] }`. Type to
filter the browser's suggestions or select an existing package; new package
names can still be entered. Loading failures do not prevent manual entry.
Independent mounts inject `loadClassPackages(signal)` into `createNewRuleDialog`.
Rule Type uses
the `/rules/types` response: `name` identifies RuleAssist, `contextClass`
prefills the context field, and `description` labels the type where supplied.
The selected assistant creates the initial rule definition and empty ruleSet.
Create verifies the assistant/context resources, POSTs the new rule, and opens it
after success. Duplicate-name failures leave the form values available to edit.

Save preserves the editor's rule content and metadata, including Timestamp,
adds an empty variables array when absent, and excludes GET-only `_sourceControl`.
Save As and New omit the source Timestamp so the server can assign a new version.
Save As does not change the copied ruleSet names. Destination class identity stays
in the URL rather than being injected into the rule-definition body.
It does not reproduce the duplicate empty-key actions wrapper present in the
supplied PUT capture. This checks JSON shape, not server compilation or acceptance;
the live API's concurrency contract may require further metadata handling.
If the write succeeds but reloading fails, the dialog reports that the write
completed and advises refreshing before retrying.

From this folder, validate forms, payloads and the API writes with:

```powershell
node --test tests/save.test.mjs tests/api.test.mjs
```

The test edits the subrule to add the sample comment, compares the generated
payload with the supplied PUT capture (without its duplicate wrapper), and checks
JSON round-tripping, downloads, Save As/New forms, failed-request preservation,
namespace isolation, version conflicts and create/reload behavior. Independent
editor mounts supply `ruleName`, asynchronous `onSave(output, signal)`, and
`onSaved(result, output)` to connect the save dialog to their own transport/state.

## Components

- `config.json`, `packages/api/config.js` and `packages/api/client.js`: runtime
  base URL, page namespace/rule parameters and all endpoint mappings.
- `mock-api.mjs`: development-only API routes backed by fixtures.
- `build.mjs`: static runtime packaging, excluding development mocks/data.
- `packages/basic-builder/model.js`: standalone projection API. Editor/preview
  data is projected through RuleAssist instead.
- `packages/basic-builder/index.js`: `createBlock`, `createNodeRow`,
  `createConditionBlock`, `createTreeLine`, `treeLineBounds`, and `renderRuleTree`.
- `packages/basic-builder/condition.js`: Chevrotain-backed condition parsing and
  display-only boolean captions; malformed input falls back to its raw string.
- `packages/basic-builder/index.css`: isolated block, count, value and tree styles.
- `packages/editor/model.js`: independent editor state, value updates,
  schema-aware additions, counted-object movement, subtree removal and history.
- `packages/editor/rule-assist.js`: resolves local RuleAssist references and
  derives field blocks, property order, defaults, read-only state, hierarchy,
  allowed additions and conditional child eligibility from the assistant.
- `packages/editor/index.js` and `index.css`: editor toolbar, selection adapter,
  shared expression dialog and scrolling canvas.
- `packages/editor/expression-model.js` and `expression-view.js`: popup draft
  editing, operator/function tree, schema dropdowns and parameter labels.
- `packages/editor/target-model.js` and `target-view.js`: shared target/transform
  entries, configurable suggestion sources, keyboard selection and removable chips.
- `packages/editor/constraint-model.js` and `constraint-view.js`: message-class
  sections, metadata-driven single/multiple selectors and constraint draft values.
- `packages/editor/save.js`, `save-view.js` and `new-view.js`: rule-definition
  construction, package/name validation, Save/Save As submission and New form.

```javascript
import { createBlock, createConditionBlock, renderRuleTree } from "./packages/basic-builder/index.js";
import { projectEditorTree } from "./packages/editor/model.js";

container.append(createBlock(document, { text: "trace", kind: "trace" }));
container.append(createBlock(document, {
  text: "condition", values: ["true", "message.Type = ADT"], kind: "property"
}));
container.append(createBlock(document, { text: "rule", count: 4, kind: "rule" }));
container.append(createConditionBlock(document, {
  text: "condition", value: '(HL7.{PV1:PatientClass}="O")&&Exists("test",HL7.{MSH:MessageType.TriggerEvent})'
}));

const mounted = renderRuleTree(treeContainer, projectEditorTree(data, ruleAssist));
// Call mounted.destroy() before disposing of the tree container.
```

Include the component stylesheet when mounting components. Values are rendered
as text, never HTML. A property label remains at the top when its value has
multiple rows. Tree connectors are separate HTML elements, measured from the
type blocks after layout and updated on resize.

`conditions` is displayed as `when`, `else` as `otherwise`, and `then` is a
structural container rather than a visible block. RuleAssist-derived property
blocks remain visible when empty; false and zero remain visible. Comments retain
their schema-defined owner and order. The Add menu distinguishes comments
attached to a condition from comment actions when both are allowed.

## Block Appearance

Edit the `:root` settings at the top of
`packages/basic-builder/index.css`. Both the main diagram and expression-popup
blocks use these shared variables; individual selector edits are not needed.

Change `--re-block-size` (default `16px`) to scale text, padding, minimum heights,
spacing, corners, borders and tree indentation together. Separate overrides are
available when only one aspect should change:

```css
:root {
  --re-block-size: 20px;
  --re-border-width: 2px;
  --re-block-radius: 8px;
  --re-font-family: "Trebuchet MS", sans-serif;
}
```

- `--re-font-size`, `--re-font-line-height`: text size and line height.
- `--re-label-font-size`, `--re-small-font-size`, `--re-expression-font-size`:
  optional individual text-size overrides, derived from the shared size by default.
- `--re-border-width`: ordinary borders; strong expression-node borders default
  to twice this value through `--re-strong-border-width`.
- `--re-line-width`, `--re-line-radius`, `--re-line-color`: connector styling.
- `--re-padding-x`, `--re-padding-y`, `--re-block-min-height`: block dimensions.
- `--re-block-gap`, `--re-row-gap`, `--re-tree-indent`, `--re-expression-gap`:
  block and branch spacing.
- `--re-block-max-width`, `--re-value-max-width`, `--re-condition-max-width`,
  `--re-expression-max-width`: wrapping limits; small-screen variants are in the
  same settings section.
- The `--re-*-fill`, text-color and border-color variables define the palette.

CSS variables can also be overridden on a diagram/editor container for a
per-instance theme. Tree anchors and property connector midpoints are measured
after resizing, so configurable fonts and dimensions remain aligned. Layout
for the surrounding page and toolbar is separate from block sizing.

## RuleAssist Definitions

The GET `rules/types/{RuleAssistClass}` API response is the source of
block definitions. There are no per-action property lists, primary-field tables,
new-object factories or action menus in the editor. Adding/removing a property or
an allowed action in the assistant changes the editor without a code change.

Fields follow assistant property order, including Send target before transform.
New objects use declared defaults; otherwise strings start empty, booleans false,
numbers zero and arrays empty. New rules therefore start with an empty conditions
array, and a new when condition starts with an empty expression unless the
assistant declares a default. Structured expression metadata is not initialized
as a fake expression. Collection-valued properties remain read-only except
through the dedicated constraint popup.

Contextual `$ref` resolution preserves differences such as foreachCondition
versus ordinary condition actions. The adapter handles the supplied RuleAssist
dialect, not arbitrary JSON Schema validation. Display aliases, transparent
containers, rule/when counters and visual styling remain presentation policies.

The supplied PUT capture is a request-shape reference, not a save implementation
or proof of server acceptance. Expression editing uses a local parser for
balanced strings, logical/comparison operators and known RuleAssist functions;
unsupported compound leaf text is retained rather than evaluated or rewritten.
An unchanged draft preserves the original expression string. This is not IRIS
compilation or complete ObjectScript validation. Changing an expression removes
stale expression AST data.
No embedded native editor, compile or source-control workflow is included.
Authentication uses the shared package; authorization and live persistence remain
the configured IRIS API's responsibility.

## Tests

```powershell
npm test
```

Tests cover data projection, block DOM construction, connector geometry, fixture
immutability, editor operations/history/movement restrictions, expression draft
operations, schema-driven choices, static serving, MIME types and rejected write
requests.
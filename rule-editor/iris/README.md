# IRIS Interoperability Tools

This package installs the Rule Editor static browser application, not an API
server. It requires an IRIS instance that already provides the compatible
`/api/interop-editors/v8` API and its authentication routes. No mock data, mock
servers, credentials or Node.js runtime are installed on IRIS.

## IPM / ZPM Installation

Extract the release ZIP on the IRIS server. In the intended application
namespace, start `zpm` and load the extracted module directory:

```text
USER>zpm
zpm:USER>load /opt/iris-interop-tools-0.1.0 -v
```

Use the directory for your release version. IPM copies the web assets to the
IRIS CSP directory and creates `/iris-tools/rule-editor` with password
authentication enabled. The installation needs permission to create web
applications and write to the CSP directory. The URL is instance-wide; install
it once and use the `$NAMESPACE` query parameter to select an API namespace.

## Installation Without IPM

Extract the ZIP into a permanent directory on the IRIS server, readable by the
IRIS service account. In an IRIS terminal, load and compile the installer into
the intended namespace, then register the extracted `web` directory:

```objectscript
USER>do $SYSTEM.OBJ.Load("/opt/iris-interop-tools-0.1.0/src/InteropTools/Installer.cls","ck")
USER>set sc = ##class(InteropTools.Installer).Install("/opt/iris-interop-tools-0.1.0/web","USER")
USER>do $SYSTEM.Status.DisplayError(sc)
```

Use absolute server-side paths (Windows paths are also supported). The installer
requires administrative privileges, enables password authentication, and refuses
to overwrite an existing application. It does not copy files: keep the extracted
directory in place. To upgrade a standalone installation, replace the contents
of its existing `web` directory after backing up environment-specific config.
To remove it, delete the web application in Management Portal and then remove
the extracted files and `InteropTools.Installer` class. For IPM installations,
use `uninstall iris-interop-tools` in the IPM shell instead.

## Configuration And Access

Set `web/config.json` before standalone installation, or the deployed CSP
directory's `config.json` after IPM installation. Keep `apiBase` pointed at the
real API; use the same origin as IRIS to avoid CORS and authentication problems.
No fallback namespace is shipped in this package. Open:

```text
http://localhost:52773/iris-tools/rule-editor/index.html?$NAMESPACE=USER
```

Use your deployment's actual host, scheme and web-server port. Configure HTTPS
for production. Users still need the existing API's namespace and application
permissions; installing this UI does not grant API access. The live preview is
not a reverse proxy. Preserve the directory layout and configure the web server
to serve `.js` as JavaScript and `.json` as JSON.
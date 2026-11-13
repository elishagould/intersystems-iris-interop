import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { zipSync } from "fflate";
import { buildStatic } from "./build.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const name = "iris-interop-tools";

export async function packageIris({ outputDirectory = resolve(root, "artifacts"), version = "0.1.0" } = {}) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(version)) throw new TypeError("Version must be a semantic version without a v prefix.");
  const output = resolve(outputDirectory);
  const sourceRelative = relative(root, output);
  if (!sourceRelative || sourceRelative === ".." || sourceRelative.startsWith(`..${sep}`) || ["packages", "node_modules", "tests", "mock-data", "iris"].includes(sourceRelative.split(sep)[0])) {
    throw new TypeError("Choose a separate output directory inside the editor, outside source directories.");
  }
  const directory = join(output, `${name}-${version}`);
  await rm(directory, { recursive: true, force: true });
  const web = await buildStatic(join(directory, "web"));
  const settings = JSON.parse(await readFile(join(web, "config.json"), "utf8"));
  delete settings.defaultNamespace;
  await writeFile(join(web, "config.json"), `${JSON.stringify(settings, null, 2)}\n`);
  await cp(join(root, "iris", "src"), join(directory, "src"), { recursive: true });
  await cp(join(root, "iris", "README.md"), join(directory, "README.md"));
  const manifest = await readFile(join(root, "iris", "module.xml"), "utf8");
  await writeFile(join(directory, "module.xml"), manifest.replace("<Version>0.1.0</Version>", `<Version>${version}</Version>`));
  const files = {};
  async function collect(parent) {
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      const path = join(parent, entry.name);
      if (entry.isDirectory()) await collect(path);
      else files[`${name}-${version}/${relative(directory, path).split(sep).join("/")}`] = new Uint8Array(await readFile(path));
    }
  }
  await collect(directory);
  const archive = `${directory}.zip`;
  await mkdir(dirname(archive), { recursive: true });
  await writeFile(archive, zipSync(files, { level: 9 }));
  return { directory, archive };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = await packageIris({ version: process.env.PACKAGE_VERSION ?? "0.1.0" });
  console.log(`IRIS module: ${result.directory}\nDeployment ZIP: ${result.archive}`);
}
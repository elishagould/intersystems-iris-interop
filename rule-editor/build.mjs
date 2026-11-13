import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const runtimeFiles = [
  "index.html", "app.js", "config.json", "preview.css", "packages",
  "node_modules/lucide/dist/umd/lucide.min.js",
  "node_modules/chevrotain/lib/chevrotain.mjs",
  "node_modules/@intersystems/iris-auth/index.js",
  "node_modules/@intersystems/iris-auth/login.js",
  "node_modules/@intersystems/iris-auth/index.css"
];

export async function buildStatic(outputDirectory = resolve(root, "dist")) {
  const output = resolve(outputDirectory);
  if (output === root || root.startsWith(`${output}/`) || root.startsWith(`${output}\\`)) throw new TypeError("Choose a separate build output directory.");
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const name of runtimeFiles) {
    const deployedName = name === "node_modules/chevrotain/lib/chevrotain.mjs" ? "node_modules/chevrotain/lib/chevrotain.js" : name;
    const target = resolve(output, deployedName);
    await mkdir(dirname(target), { recursive: true });
    await cp(resolve(root, name), target, { recursive: true });
  }
  const conditionPath = resolve(output, "packages/basic-builder/condition.js");
  const condition = await readFile(conditionPath, "utf8");
  if (!condition.includes("chevrotain/lib/chevrotain.mjs")) throw new Error("Review the deployed condition parser import before building.");
  await writeFile(conditionPath, condition.replace("chevrotain/lib/chevrotain.mjs", "chevrotain/lib/chevrotain.js"));
  return output;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log(`Static web assets: ${await buildStatic()}`);
}
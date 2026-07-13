import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const distDir = path.join(root, "dist");
const assetsDir = path.join(distDir, "assets");
const buildEnv = await loadEnv();
const publishableKey = buildEnv.VITE_CLERK_PUBLISHABLE_KEY;
const managedResearchCheckoutEnabled = buildEnv.VITE_MANAGED_RESEARCH_CHECKOUT_ENABLED === "true" ? "true" : "false";
const appName = buildEnv.VITE_APP_NAME || "Beach Car Watch";
const appShortName = buildEnv.VITE_APP_SHORT_NAME || "Beachcar";

if (!publishableKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

await rm(distDir, { force: true, recursive: true });
await mkdir(assetsDir, { recursive: true });
await cp(path.join(root, "public"), distDir, { recursive: true });
await writeManifest();
await cp(path.join(root, "src/client/styles.css"), path.join(assetsDir, "styles.css"));

for (const file of ["main.tsx", "App.tsx", "api.ts", "clerk-browser.ts"]) {
  await transpileClientFile(file);
}
await transpileSharedFile("ai-keys.ts");

await writeFile(
  path.join(distDir, "index.html"),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#f7f4ec" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="${escapeHtml(appShortName)}" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="stylesheet" href="/assets/styles.css" />
    <script type="importmap">
      {
        "imports": {
          "react": "https://esm.sh/react@19.2.3",
          "react-dom/client": "https://esm.sh/react-dom@19.2.3/client",
          "react/jsx-runtime": "https://esm.sh/react@19.2.3/jsx-runtime",
          "lucide-react": "https://esm.sh/lucide-react@0.562.0?external=react"
        }
      }
    </script>
    <title>${escapeHtml(appName)}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/main.js"></script>
  </body>
</html>
`,
);

console.log("Built client assets in dist/");

async function transpileClientFile(file) {
  const inputPath = path.join(root, "src/client", file);
  const outputPath = path.join(assetsDir, file.replace(/\.(tsx|ts)$/, ".js"));
  await transpileBrowserFile(inputPath, outputPath);
}

async function transpileSharedFile(file) {
  const inputPath = path.join(root, "src/shared", file);
  const outputPath = path.join(assetsDir, file.replace(/\.(tsx|ts)$/, ".js"));
  await transpileBrowserFile(inputPath, outputPath);
}

async function transpileBrowserFile(inputPath, outputPath) {
  const source = await readFile(inputPath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
    fileName: inputPath,
    reportDiagnostics: true,
  });

  const diagnostics = transpiled.diagnostics || [];
  const errors = diagnostics.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (errors.length) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, formatHost));
  }

  const output = rewriteBrowserImports(transpiled.outputText)
    .replaceAll("import.meta.env.VITE_CLERK_PUBLISHABLE_KEY", JSON.stringify(publishableKey))
    .replaceAll("import.meta.env.VITE_MANAGED_RESEARCH_CHECKOUT_ENABLED", JSON.stringify(managedResearchCheckoutEnabled))
    .replaceAll("import.meta.env.VITE_APP_NAME", JSON.stringify(appName))
    .replaceAll("import.meta.env.VITE_APP_SHORT_NAME", JSON.stringify(appShortName))
    .replaceAll("import.meta.env.DEV", "false")
    .replace(/^import\s+["']\.\/styles\.css["'];?\n?/m, "");
  await writeFile(outputPath, output);
}

async function writeManifest() {
  await writeFile(
    path.join(distDir, "manifest.webmanifest"),
    JSON.stringify(
      {
        name: appName,
        short_name: appShortName,
        description: "A private daily auction shortlist curated by an AI research automation.",
        start_url: "/",
        display: "standalone",
        background_color: "#f7f4ec",
        theme_color: "#f7f4ec",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      null,
      2,
    ),
  );
}

function rewriteBrowserImports(code) {
  return code
    .replaceAll('from "./App"', 'from "./App.js"')
    .replaceAll('from "./api"', 'from "./api.js"')
    .replaceAll('from "./clerk-browser"', 'from "./clerk-browser.js"')
    .replaceAll('from "../shared/ai-keys"', 'from "./ai-keys.js"');
}

async function loadEnv() {
  let env = { ...process.env };
  for (const file of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    env = { ...env, ...(await parseEnvFile(path.join(root, file))) };
  }
  return env;
}

async function parseEnvFile(file) {
  try {
    const contents = await readFile(file, "utf8");
    const env = {};
    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator === -1) continue;
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
      env[key] = value;
    }
    return env;
  } catch {
    return {};
  }
}

const formatHost = {
  getCanonicalFileName: (file) => file,
  getCurrentDirectory: () => root,
  getNewLine: () => "\n",
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

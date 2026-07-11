#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const remote = args.includes("--remote");
const persistTo = valueArg("--persist-to");

if (remote) {
  console.error(
    "Direct remote D1 migration is disabled. Use bun run deploy:remote -- --execute --yes so production account, D1 identity, rollback, backup, pending-migration, schema, and strict-deploy gates run first.",
  );
  process.exit(1);
}

const wrangler = await readJsonc(resolve("wrangler.jsonc"));
const databaseName = stringValue(wrangler?.d1_databases?.[0]?.database_name);

if (!databaseName) {
  console.error("No D1 database_name found in wrangler.jsonc.");
  process.exit(1);
}

const command = ["bunx", "wrangler", "d1", "migrations", "apply", databaseName, "--local"];
if (persistTo) command.push("--persist-to", persistTo);
const proc = Bun.spawn(command, {
  cwd: process.cwd(),
  stdout: "inherit",
  stderr: "inherit",
});

process.exit(await proc.exited);

async function readJsonc(path) {
  const text = await readFile(path, "utf8");
  return JSON.parse(stripJsonComments(text));
}

function stripJsonComments(text) {
  let output = "";
  let inString = false;
  let quote = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inString) {
      output += char;
      if (char === "\\" && next) {
        output += next;
        index += 1;
      } else if (char === quote) {
        inString = false;
      }
    } else if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      output += char;
    } else if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
      output += "\n";
    } else if (char === "/" && next === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index += 1;
      index += 1;
    } else {
      output += char;
    }
  }
  return output;
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function valueArg(name) {
  const index = args.indexOf(name);
  if (index < 0) return "";
  return stringValue(args[index + 1]);
}

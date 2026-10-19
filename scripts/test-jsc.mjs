#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileLibrary } from "../packages/compiler/dist/index.js";

const sanitize = process.env.SCRIPTC_SAN === "1";
const cache = resolve("node_modules/.cache/scriptc-jsc");
await mkdir(cache, { recursive: true });
const directory = await mkdtemp(`${cache}/fixture-`);
try {
  await writeFile(`${directory}/entry.ts`, "export function answer(): number { return 42; }\n");
  const profilePath = `${directory}/profile.json`;
  await writeFile(
    profilePath,
    JSON.stringify({
      profile_format: 1,
      name: "jsc-lifetimes",
      entry: "entry.ts",
      emission: "llvm",
      abi: {
        prefix: "fixture_",
        init_symbol: "fixture_init",
        sink_register_symbol: "fixture_sink",
      },
      exports: [{ export: "answer", symbol: "fixture_answer", params: [], returns: "f64" }],
    }),
  );
  const result = await compileLibrary({ profilePath, outDir: directory, sanitize });
  if (!result.ok)
    throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  execFileSync(
    "swift",
    [
      "test",
      "--package-path",
      fileURLToPath(new URL("../packages/jsc", import.meta.url)),
      "--scratch-path",
      `${cache}/${sanitize ? "asan" : "release"}`,
      "-c",
      "release",
      ...(sanitize ? ["--sanitize", "address"] : []),
    ],
    { stdio: "inherit", env: { ...process.env, SCRIPTC_RUNTIME_LIBRARY: result.archivePath } },
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}

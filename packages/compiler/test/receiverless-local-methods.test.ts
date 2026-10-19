import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { compile, deserializeModule } from "../src/index.js";

test.each([
  `function make() { class Local { method() { return 7; } } return new Local(); }
   const object = make(); const method = object.method; console.log(method());`,
  `let C; function initialize() { C = class { method() { return 7; } }; }
   initialize(); const object = new C(); const method = object.method; console.log(method());`,
])("detached local methods omit empty class-environment metadata", async (source) => {
  const mod = await compileSource(source);
  const clone = mod.functions.find((fn) => fn.name.startsWith("%method.receiverless:"));
  expect(clone).toBeDefined();
  expect(clone!.classCaptures).toBeUndefined();
  expect(clone!.params).toHaveLength(0);
  const original = mod.functions.find(
    (fn) => fn.name === clone!.name.slice("%method.receiverless:".length),
  );
  expect(original!.classCaptures).toEqual([]);
  expect(original!.params[0]?.name).toBe("this");
});

test("a method using a local-class capture keeps its receiver and capture metadata", async () => {
  const mod = await compileSource(`
    function make(value) { class Local { method() { return value; } } return new Local(); }
    const object = make(7); const method = object.method; console.log(method.call(object));
  `);
  expect(mod.functions.some((fn) => fn.name.startsWith("%method.receiverless:"))).toBe(false);
  const original = mod.functions.find(
    (fn) => fn.name.endsWith(".method") && fn.classCaptures?.length,
  );
  expect(original).toBeDefined();
  expect(original!.classCaptures).toHaveLength(1);
  expect(original!.params[0]?.name).toBe("this");
});

async function compileSource(source: string) {
  const directory = await mkdtemp(join(tmpdir(), "scriptc-receiverless-local-"));
  try {
    const entry = join(directory, "main.js"),
      outPath = join(directory, "main.ir.json");
    await writeFile(entry, source);
    const result = await compile(entry, { outDir: directory, outPath, outputKind: "ir" });
    if (!result.ok)
      throw new Error(result.diagnostics.map((diag) => `${diag.code}: ${diag.message}`).join("\n"));
    return deserializeModule(await readFile(outPath, "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

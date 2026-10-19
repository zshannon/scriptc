import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { compile } from "../src/index.js";

test("JavaScript conditional function constructors preserve captures and nullish errors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scriptc-nullable-constructor-"));
  try {
    const entry = join(directory, "main.js");
    await writeFile(
      entry,
      `
      function initialize() {
        function create() { return new Controller(); }
        var Controller = false ? void 0 : function () {
          var listeners = [], signal = this.signal = {
            aborted: false,
            addEventListener: function (listener) { listeners.push(listener); }
          };
          this.abort = function () {
            signal.aborted = true;
            listeners.forEach(function (listener) { listener(); });
          };
        };
        var called = 0, controller = create();
        controller.signal.addEventListener(function () { called++; });
        controller.abort();
        console.log(controller.signal.aborted, called);
      }
      function attempt(enabled) {
        var Ctor = enabled ? function () { this.value = 7; } : undefined;
        try { console.log(new Ctor().value); }
        catch (error) { console.log(error instanceof TypeError); }
      }
      initialize();
      attempt(true);
      attempt(false);
    `,
    );
    const result = await compile(entry, {
      outDir: directory,
      outPath: join(directory, "program"),
      sanitize: process.env["SCRIPTC_SAN"] === "1",
    });
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) return;
    const child = spawnSync(result.binaryPath, [], { encoding: "utf8", timeout: 30_000 });
    expect(child.status, child.stderr).toBe(0);
    expect(child.stderr).toBe("");
    expect(child.stdout).toBe("true 1\n7\ntrue\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test.each([
  { extension: "ts", source: "let Ctor: (() => void) | undefined = undefined; new Ctor();" },
  { extension: "js", source: "const Ctor = Math.random() ? 7 : undefined; new Ctor();" },
])("does not admit a nonconstructor $extension binding", async ({ extension, source }) => {
  const directory = await mkdtemp(join(tmpdir(), "scriptc-constructor-fence-"));
  try {
    const entry = join(directory, `main.${extension}`);
    await writeFile(entry, source);
    const result = await compile(entry, {
      outDir: directory,
      outPath: join(directory, "program"),
      sanitize: process.env["SCRIPTC_SAN"] === "1",
    });
    if (extension === "ts") {
      expect(result.ok).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    } else {
      expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
      if (!result.ok) return;
      const child = spawnSync(result.binaryPath, [], { encoding: "utf8", timeout: 30_000 });
      expect(child.status).toBe(1);
      expect(child.stderr).toContain(
        "constructing values other than classes declared in the program",
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

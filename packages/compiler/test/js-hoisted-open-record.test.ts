import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { compile, compileLibrary, deserializeModule } from "../src/index.js";

test.each(["var", "let", "const"])(
  "%s JavaScript null-initialized records keep open storage",
  async (binding) => {
    const mod = await compileSource(
      `
    function initialize() {
      ${binding} shared = { S: null, H: null };
      function install(value) { value.S = function () { return 7; }; }
      install(shared);
      return shared.S();
    }
    console.log(initialize());
  `,
      "js",
    );
    const fn = mod.functions.find((fn) => fn.name === "initialize");
    expect(fn).toBeDefined();
    expect(fn!.locals.find((local) => local.name === "shared")?.type).toEqual({ kind: "dyn" });
  },
);

test.each(["js", "ts"])(
  "%s hoisted fixed numeric records retain their typed storage",
  async (extension) => {
    const mod = await compileSource(
      `
    function initialize() {
      var shared = { value: 7 };
      return shared.value;
    }
    console.log(initialize());
  `,
      extension,
    );
    const fn = mod.functions.find((fn) => fn.name === "initialize");
    const type = fn!.locals.find((local) => local.name === "shared")?.type;
    expect(type?.kind).not.toBe("dyn");
    expect(
      mod.records?.some((record) =>
        record.fields.some((field) => field.name === "value" && field.type.kind === "f64"),
      ),
    ).toBe(true);
  },
);

test.each([
  [`var shared = { value: 1 }; shared.extra = () => 7; return shared.extra();`, "dyn"],
  [
    `var shared = { value: 1 }; var alias = shared; alias.extra = () => 7; return alias.extra();`,
    "dyn",
  ],
  [`var shared = 1; shared = "changed"; return shared.length;`, "jsval"],
  [
    `var shared = 1; function replace(value) { shared = value; } replace("changed"); return shared.length;`,
    "dyn",
  ],
])("hoisted JavaScript writes keep the inferred binding open: %s", async (body, kind) => {
  const mod = await compileSource(
    `function initialize() { ${body} } console.log(initialize());`,
    "js",
  );
  const fn = mod.functions.find((fn) => fn.name === "initialize");
  expect(fn!.locals.find((local) => local.name === "shared")?.type).toEqual({ kind });
});

test("library initialization executes open-object writes and higher-order reads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scriptc-open-var-library-"));
  try {
    const entry = join(directory, "entry.mjs");
    await writeFile(
      entry,
      `
      function initialize() {
        var shared = { S: null };
        function install(value) { value.S = () => 7; }
        install(shared);
        var dispatcher = { first: () => 1 };
        dispatcher.next = shared.S;
        function invoke(callback) { return callback(); }
        var replaced = 1;
        replaced = "done";
        var fixed = { value: 3 };
        function shadow() { var fixed = { value: 4 }; return fixed.value; }
        return invoke(dispatcher.next) + replaced.length + fixed.value + shadow();
      }
      const value = initialize();
      export function result() { return Number(value); }
    `,
    );
    const profilePath = join(directory, "profile.json");
    await writeFile(
      profilePath,
      JSON.stringify({
        profile_format: 1,
        name: "open-var",
        entry: "entry.mjs",
        emission: "llvm",
        abi: {
          prefix: "ov_",
          init_symbol: "ov_init",
          sink_register_symbol: "ov_sink",
          collect_symbol: "ov_collect",
        },
        exports: [{ export: "result", symbol: "ov_result", params: [], returns: "f64" }],
      }),
    );
    const sanitize = process.env["SCRIPTC_SAN"] === "1";
    const result = await compileLibrary({ profilePath, outDir: join(directory, "out"), sanitize });
    if (!result.ok)
      throw new Error(result.diagnostics.map((diag) => `${diag.code}: ${diag.message}`).join("\n"));
    if (process.env["SCRIPTC_PORTABLE_ONLY"] !== "1") {
      const host = join(directory, "host.c"),
        binary = join(directory, "host");
      await writeFile(
        host,
        '#include <stdio.h>\nextern void ov_init(void); extern double ov_result(void);\nint main(void) { ov_init(); printf("%.0f\\n", ov_result()); }\n',
      );
      execFileSync("clang", [
        host,
        result.archivePath,
        ...(sanitize ? ["-fsanitize=address"] : []),
        "-lm",
        "-o",
        binary,
      ]);
      expect(execFileSync(binary, { encoding: "utf8" })).toBe("18\n");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function compileSource(source: string, extension: string) {
  const directory = await mkdtemp(join(tmpdir(), "scriptc-open-var-"));
  try {
    const entry = join(directory, `main.${extension}`),
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

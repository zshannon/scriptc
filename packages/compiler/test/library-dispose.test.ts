import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { compileLibrary } from "../src/index.js";

const supported =
  process.env["SCRIPTC_PORTABLE_ONLY"] !== "1" &&
  (process.platform === "darwin" || process.platform === "linux");

test.runIf(supported)(
  "disposal releases compiled globals while host references remain valid",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "scriptc-library-dispose-"));
    try {
      await writeFile(
        join(dir, "lib.ts"),
        'const names = new Map<string, string>(); names.set("name", "native");\nexport function value(): string { return names.get("name") ?? ""; }\n',
      );
      const profilePath = join(dir, "profile.json");
      await writeFile(
        profilePath,
        JSON.stringify({
          profile_format: 1,
          name: "dispose-test",
          entry: "lib.ts",
          emission: "llvm",
          abi: {
            prefix: "dt_",
            init_symbol: "dt_init",
            dispose_symbol: "dt_dispose",
            sink_register_symbol: "dt_set_panic_sink",
            collect_symbol: "dt_collect",
            result_reset_symbol: null,
          },
          exports: [{ export: "value", symbol: "dt_value", params: [], returns: "string" }],
        }),
      );
      const result = await compileLibrary({ profilePath, outDir: dir, sanitize: true });
      if (!result.ok) throw new Error(result.diagnostics.map((d) => d.message).join("\n"));
      const probe = join(dir, "probe.c");
      const binary = join(dir, "probe");
      await writeFile(
        probe,
        `#include "scr_runtime.h"
#include <stdio.h>
#include <string.h>
extern void dt_init(void), dt_dispose(void);
extern void dt_set_panic_sink(void (*)(void *, const uint8_t *, size_t, uint64_t), void *);
static void panic_sink(void *context, const uint8_t *message, size_t length, uint64_t address) {
  fwrite(message, 1, length, stderr); exit(99);
}
extern long scr_map_live_count(void), scr_str_live_count(void);
typedef struct { size_t rc; } Foreign;
static int destroyed;
static void *foreign_retain(void *value) { ((Foreign *)value)->rc++; return value; }
static void foreign_release(void *value) {
  if (--((Foreign *)value)->rc == 0) { destroyed++; free(value); }
}
static const ScrDynForeignOps foreign_ops = {
  .base = { .cls = "TestForeign", .retain = foreign_retain, .release = foreign_release },
};
int main(int argc, char **argv) {
  dt_set_panic_sink(panic_sink, NULL);
  dt_init();
  ScrStr *held = scr_str_new("host owned", 10);
  scr_dyn_handle_install(SCR_DYNH_FOREIGN, &foreign_ops.base);
  ScrError *error = scr_error_new(SCR_ERR_ERROR, NULL);
  ScrDyn *view = scr_dyn_from_error(error);
  Foreign *foreign = calloc(1, sizeof *foreign);
  scr_dyn_obj_set(view, "child", 5, scr_dyn_new_handle(foreign, SCR_DYNH_FOREIGN));
  scr_dyn_release(view);
  scr_error_release(error); /* Only the runtime Error cache retains the child. */
  dt_dispose();
  if (destroyed != 1) return 4;
  if (scr_map_live_count() != 0 || scr_str_live_count() != 1) return 2;
  if (held->len != 10 || memcmp(held->data, "host owned", 10) != 0) return 3;
  if (argc == 1) scr_str_release(held);
  dt_init(); /* Reinitialization must still reject a leaked host reference. */
  dt_dispose();
  scr_library_reset();
  puts("dispose and reinitialize passed");
  return 0;
}
`,
      );
      execFileSync("clang", [
        "-std=c11",
        "-DSCR_LIB",
        "-fsanitize=address",
        "-I",
        join(import.meta.dirname, "../../runtime/src"),
        probe,
        result.archivePath,
        "-lm",
        "-o",
        binary,
      ]);
      const env = { ...process.env, ASAN_OPTIONS: "detect_leaks=0" };
      const run = spawnSync(binary, [], { encoding: "utf8", env });
      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
      expect(run.stdout).toBe("dispose and reinitialize passed\n");
      const leaked = spawnSync(binary, ["leak"], { encoding: "utf8", env });
      expect(leaked.status).not.toBe(0);
      expect(leaked.stderr).toContain("LIBRARY RC AUDIT FAILED");
      expect(leaked.stderr).toContain("dt_init");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { compileLibrary } from "../src/index.js";

const supported =
  process.env["SCRIPTC_PORTABLE_ONLY"] !== "1" &&
  (process.platform === "darwin" || process.platform === "linux");

test.runIf(supported).each([false, true])(
  "threaded library allocation survives concurrent session resets and late host releases (sanitized=%s)",
  async (sanitize) => {
    const dir = await mkdtemp(join(tmpdir(), "scriptc-thread-allocator-"));
    try {
      await symlink(join(import.meta.dirname, "../../../node_modules"), join(dir, "node_modules"));
      await writeFile(
        join(dir, "lib.ts"),
        `class Cell {
  constructor(public next: Cell | null, public value: number) {}
}
let calls = 0;
let root: Cell | null = null;
export function work(n: number): number {
  calls++;
  root = null;
  for (let i = 0; i < n; i++) root = new Cell(root, i);
  let sum = calls;
  for (let p = root; p !== null; p = p.next) sum += p.value;
  return sum;
}

`,
      );
      const profilePath = join(dir, "profile.json");
      await writeFile(
        profilePath,
        JSON.stringify({
          profile_format: 1,
          name: "thread-allocator-test",
          entry: "lib.ts",
          emission: "llvm",
          abi: {
            prefix: "at_",
            init_symbol: "at_init",
            dispose_symbol: "at_dispose",
            sink_register_symbol: "at_set_panic_sink",
            result_reset_symbol: null,
            instance_per_thread: true,
          },
          exports: [{ export: "work", symbol: "at_work", params: ["f64"], returns: "f64" }],
        }),
      );
      const result = await compileLibrary({ profilePath, outDir: dir, sanitize });
      if (!result.ok) throw new Error(result.diagnostics.map((d) => d.message).join("\n"));
      const llvm = await readFile(join(dir, "lib.lib.ll"), "utf8");
      expect(llvm).toMatch(/@scr_thread_hot = external thread_local.* global /);
      expect(llvm).toContain("call ptr @llvm.threadlocal.address.p0(ptr @scr_thread_hot)");
      expect(llvm).toContain("%sa.small =");
      expect(llvm).not.toMatch(/@scr_(sa|cyc_live|cyc_old_freed|weak_dispose_hook) = external/);
      const probe = join(dir, "probe.c");
      const binary = join(dir, "probe");
      await writeFile(
        probe,
        `#include "scr_runtime.h"
#include <assert.h>
#include <pthread.h>
#include <stdio.h>
#include <string.h>
extern void at_init(void), at_dispose(void);
extern double at_work(double);
extern void at_set_panic_sink(void (*)(void *, const uint8_t *, size_t, uint64_t), void *);
static void panic_sink(void *context, const uint8_t *message, size_t length, uint64_t address) {
  fwrite(message, 1, length, stderr); abort();
}
static void *sessions(void *context) {
  size_t n = (size_t)context;
  at_set_panic_sink(panic_sink, NULL);
  uintptr_t arena = 0;
  for (unsigned session = 0; session < 48; session++) {
    at_init();
    assert(at_work(n) == 1 + n * (n - 1) / 2);
    assert(at_work(n) == 2 + n * (n - 1) / 2);
    ScrStr *held = scr_str_new("host owned", 10);
#if SCR_SMALL_ALLOC
    assert((uintptr_t)held - scr_sa.base < scr_sa.span);
    if (arena) assert(scr_sa.base == arena);
    arena = scr_sa.base;
#endif
    at_dispose();
    assert(held->len == 10 && memcmp(held->data, "host owned", 10) == 0);
    scr_str_release(held);
    scr_library_reset();
  }
  return NULL;
}
int main(void) {
  pthread_t threads[4];
  for (uintptr_t i = 0; i < 4; i++)
    assert(pthread_create(&threads[i], NULL, sessions, (void *)(10 + i)) == 0);
  for (unsigned i = 0; i < 4; i++) assert(pthread_join(threads[i], NULL) == 0);
  puts("threaded allocation and reinitialization passed");
  return 0;
}
`,
      );
      execFileSync("clang", [
        "-std=c11",
        "-pthread",
        "-DSCR_LIB",
        "-DSCR_THREAD_INSTANCES",
        ...(sanitize ? ["-fsanitize=address"] : []),
        "-I",
        join(import.meta.dirname, "../../runtime/src"),
        probe,
        result.archivePath,
        "-lm",
        "-o",
        binary,
      ]);
      const run = spawnSync(binary, [], {
        encoding: "utf8",
        env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0:halt_on_error=1" },
        timeout: 30_000,
      });
      expect(run.stderr).toBe("");
      expect(run.signal).toBeNull();
      expect(run.status).toBe(0);
      expect(run.stdout).toBe("threaded allocation and reinitialization passed\n");

      // Sharing the allocator TLS must not admit executable-only region ownership.
      await writeFile(
        join(dir, "lib.ts"),
        `import type { ProgramLifetime } from "@scriptc/types";
class RegionCell implements ProgramLifetime {
  constructor(public value: number) {}
}
export function work(n: number): number { return new RegionCell(n).value; }
`,
      );
      const refused = await compileLibrary({ profilePath, outDir: dir, sanitize });
      expect(refused.ok).toBe(false);
      expect(refused.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "SC7008",
          message: "'RegionCell' is declared ProgramLifetime in a library build",
        }),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

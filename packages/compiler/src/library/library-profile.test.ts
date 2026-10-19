import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { loadLibraryProfile } from "./library-profile.js";

const directory = mkdtempSync(join(tmpdir(), "scriptc-boundary-profile-"));
const path = join(directory, "profile.json");
const profile = {
  profile_format: 1,
  name: "native-boundary",
  entry: "entry.ts",
  emission: "llvm",
  abi: {
    prefix: "boundary_",
    init_symbol: "boundary_init",
    sink_register_symbol: "boundary_sink",
  },
  exports: [],
};

afterAll(() => rmSync(directory, { recursive: true, force: true }));

test.each([{}, { native_value_interop: false, jsc_gc: false, jsc_gc_stack_roots: false }])(
  "ordinary native ownership accepts omitted or disabled experiments: %j",
  (modes) => {
    writeFileSync(path, JSON.stringify({ ...profile, ...modes }));
    expect(loadLibraryProfile(path).ok).toBe(true);
  },
);

test.each([
  { native_value_interop: true },
  { jsc_gc: true },
  { jsc_gc: true, jsc_gc_stack_roots: true },
])("refuses an abandoned ownership experiment before compilation: %j", (modes) => {
  writeFileSync(path, JSON.stringify({ ...profile, ...modes }));
  const result = loadLibraryProfile(path);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("unsupported ownership mode was accepted");
  expect(result.diagnostics[0]?.message).toContain("unsupported ownership experiment");
});

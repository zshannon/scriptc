import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "js-yaml";
import { afterEach, expect, test } from "vitest";

// Exercise the actual workflow publisher, not a second implementation.
const publisher = readFileSync(".github/workflows/release.yml", "utf8").match(
  /^          publish_dir\(\) \{[\s\S]*?^          \}/m,
)?.[0];
if (publisher === undefined) throw new Error("release publisher function is missing");
const directories: string[] = [];
afterEach(() =>
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })),
);

test.each([
  {
    name: "identical published bytes",
    registry: "same",
    staged: false,
    receipt: "",
    accepted: true,
  },
  {
    name: "different published bytes",
    registry: "other",
    staged: false,
    receipt: "",
    accepted: false,
  },
  { name: "unverifiable staged bytes", registry: "", staged: true, receipt: "", accepted: false },
  {
    name: "matching accepted receipt",
    registry: "",
    staged: false,
    receipt: "same",
    accepted: true,
  },
  {
    name: "changed bytes after an accepted upload",
    registry: "other",
    staged: false,
    receipt: "other",
    accepted: false,
  },
])("release retry: $name", ({ registry, staged, receipt, accepted }) => {
  const root = mkdtempSync(join(tmpdir(), "scriptc-release-integrity-"));
  directories.push(root);
  mkdirSync(join(root, "packages/runtime"), { recursive: true });
  mkdirSync(join(root, "bin"));
  writeFileSync(
    join(root, "packages/runtime/package.json"),
    JSON.stringify({ name: "@zshannon/scriptc-runtime", version: "0.3.5" }),
  );
  mkdirSync(join(root, "release-assets"));
  const tarball = join(root, "release-assets/zshannon-scriptc-runtime-0.3.5.tgz");
  writeFileSync(tarball, "candidate package bytes");
  const integrity = "sha512-" + createHash("sha512").update(readFileSync(tarball)).digest("base64");
  writeFileSync(
    join(root, "npm-accepted.txt"),
    receipt
      ? "@zshannon/scriptc-runtime@0.3.5 " +
          (receipt === "same" ? integrity : "sha512-other") +
          "\n"
      : "",
  );
  writeFileSync(
    join(root, "bin/npm"),
    `#!/usr/bin/env node
if(process.argv[2]==="publish") {
  if(process.env.TEST_STAGED==="1") console.log('npm error code E409\\nCannot publish over previously staged version "0.3.5".');
  process.exit(1);
}
if(process.argv[2]==="view" && process.env.TEST_INTEGRITY) console.log(process.env.TEST_INTEGRITY);
else process.exit(1);
`,
    { mode: 0o755 },
  );
  const result = spawnSync(
    "bash",
    ["-c", "set -eo pipefail\n" + publisher + "\npublish_dir packages/runtime"],
    {
      cwd: root,
      env: {
        ...process.env,
        PATH: join(root, "bin") + ":" + process.env.PATH,
        RUNNER_TEMP: root,
        VERSION: "0.3.5",
        PROVENANCE: "",
        TEST_STAGED: staged ? "1" : "0",
        TEST_INTEGRITY:
          registry === "same" ? integrity : registry === "other" ? "sha512-other" : "",
      },
      encoding: "utf8",
    },
  );
  expect(result.status === 0, result.stdout + result.stderr).toBe(accepted);
  if (accepted) expect(readFileSync(join(root, "npm-accepted.txt"), "utf8")).toContain(integrity);
});

const ci = load(readFileSync(".github/workflows/fork-ci.yml", "utf8")) as {
  jobs: {
    release: { if: string; needs: string; uses: string; permissions: Record<string, string> };
  };
  concurrency: { "cancel-in-progress": string };
};
const release = load(readFileSync(".github/workflows/release.yml", "utf8")) as {
  on: Record<string, unknown>;
  jobs: Record<string, { if?: string; "runs-on"?: string }>;
};

test.each([
  ["push", "refs/heads/main", "zshannon/scriptc", true],
  ["workflow_dispatch", "refs/heads/main", "zshannon/scriptc", true],
  ["pull_request", "refs/heads/main", "zshannon/scriptc", false],
  ["push", "refs/heads/feature", "zshannon/scriptc", false],
  ["push", "refs/heads/main", "someone/scriptc", false],
  ["schedule", "refs/heads/main", "zshannon/scriptc", false],
])("release eligibility: %s %s %s", (event_name, ref, repository, eligible) => {
  for (const condition of [ci.jobs.release.if, release.jobs["check-release"]!.if]) {
    // Execute the workflow's actual string-comparison condition with event fixtures.
    const accepts = new Function("github", `return (${condition});`);
    expect(accepts({ event_name, ref, repository })).toBe(eligible);
  }
});

test("release waits for validation and keeps main publication running", () => {
  expect(ci.jobs.release.needs).toBe("checks");
  expect(ci.jobs.release.uses).toBe("./.github/workflows/release.yml");
  expect(ci.jobs.release.permissions["id-token"]).toBe("write");
  expect(Object.keys(release.on)).toEqual(["workflow_call"]);
  expect(release.jobs.publish!["runs-on"]).toBe("ubuntu-latest");
  expect(ci.concurrency["cancel-in-progress"]).toBe("${{ github.event_name == 'pull_request' }}");
});

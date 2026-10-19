import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";

const script = resolve("scripts/sync-upstream.mjs");
let directory: string;
let upstream: string;
let fork: string;
let work: string;
let env: NodeJS.ProcessEnv;
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "scriptc-upstream-"));
  upstream = join(directory, "upstream");
  fork = join(directory, "fork.git");
  work = join(directory, "work");
  mkdirSync(upstream);
  git(upstream, "init", "-b", "main");
  git(upstream, "config", "user.name", "Test");
  git(upstream, "config", "user.email", "test@example.com");
  writeFileSync(join(upstream, "value"), "base\n");
  git(upstream, "add", ".");
  git(upstream, "commit", "-m", "base");
  git(upstream, "tag", "v0.3.5");
  git(directory, "clone", "--bare", upstream, fork);
  git(directory, "clone", fork, work);
  git(work, "config", "user.name", "Test");
  git(work, "config", "user.email", "test@example.com");
  git(work, "config", `url.${upstream}.insteadOf`, "https://github.com/vercel-labs/scriptc.git");
  mkdirSync(join(directory, "bin"));
  writeFileSync(join(directory, "state.json"), JSON.stringify({ tag: "v0.3.5", prs: [] }));
  writeFileSync(
    join(directory, "bin", "gh"),
    `#!/usr/bin/env node
const fs = require('node:fs');
const path = process.env.TEST_GH_STATE;
const state = JSON.parse(fs.readFileSync(path, 'utf8'));
const args = process.argv.slice(2);
if (state.fail) { console.error('GitHub API failed'); process.exit(1); }
if (args[0] === 'api' && args[1].endsWith('/releases/latest')) console.log(JSON.stringify({ tag_name: state.tag }));
else if (args[0] === 'api' && args[1].endsWith('/pulls')) console.log(JSON.stringify(state.prs));
else if (args[0] === 'pr' && args[1] === 'create') {
  state.createArgs = args;
  state.body = fs.readFileSync(args[args.indexOf('--body-file') + 1], 'utf8');
  state.prs.push({ state: 'open', number: 1, body: state.body });
  fs.writeFileSync(path, JSON.stringify(state)); console.log('https://github.com/zshannon/scriptc/pull/1');
} else { console.error(args); process.exit(2); }
`,
    { mode: 0o755 },
  );
  env = {
    ...process.env,
    PATH: join(directory, "bin") + ":" + process.env.PATH,
    GITHUB_REPOSITORY: "zshannon/scriptc",
    TEST_GH_STATE: join(directory, "state.json"),
  };
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function state() {
  return JSON.parse(readFileSync(join(directory, "state.json"), "utf8"));
}
function save(value: object) {
  writeFileSync(join(directory, "state.json"), JSON.stringify(value));
}
function release(tag = "v0.3.6", value = "upstream\n") {
  writeFileSync(join(upstream, "value"), value);
  git(upstream, "add", ".");
  git(upstream, "commit", "-m", "release");
  git(upstream, "tag", tag);
  save({ ...state(), tag });
  return git(upstream, "rev-parse", "HEAD");
}
function run() {
  return spawnSync(process.execPath, [script], { cwd: work, env, encoding: "utf8" });
}

test("included release does not create a branch or PR", () => {
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  expect(state().prs).toEqual([]);
  expect(git(fork, "branch", "--list", "upstream/*")).toBe("");
});
test("an initial baseline must be the exact release commit", () => {
  const sha = release();
  git(work, "fetch", upstream, "main");
  git(work, "merge", "--ff-only", sha);
  writeFileSync(join(upstream, "after-release"), "already imported\n");
  git(upstream, "add", ".");
  git(upstream, "commit", "-m", "after release");
  const revision = git(upstream, "rev-parse", "HEAD");
  git(work, "fetch", upstream, "main");
  git(work, "merge", "--ff-only", revision);
  mkdirSync(join(work, ".github"));
  writeFileSync(
    join(work, ".github/upstream-scriptc.json"),
    JSON.stringify({ version: "v0.3.6", revision }),
  );
  git(work, "add", ".");
  git(work, "commit", "-m", "record initial baseline");
  const result = run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("baseline is not the exact release");
  expect(state().prs).toEqual([]);
});
test("a moved initial release tag fails before creating a proposal", () => {
  const revision = git(work, "rev-parse", "HEAD");
  mkdirSync(join(work, ".github"));
  writeFileSync(
    join(work, ".github/upstream-scriptc.json"),
    JSON.stringify({ version: "v0.3.5", revision }),
  );
  git(work, "add", ".");
  git(work, "commit", "-m", "record initial baseline");
  writeFileSync(join(upstream, "value"), "moved\n");
  git(upstream, "add", ".");
  git(upstream, "commit", "-m", "move tag");
  git(upstream, "tag", "-f", "v0.3.5");
  const result = run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("upstream tag changed");
  expect(state().prs).toEqual([]);
  expect(git(fork, "branch", "--list", "upstream/*")).toBe("");
});
test("new release opens one cumulative PR and repeated runs reuse it", () => {
  const sha = release();
  const base = git(fork, "rev-parse", "main");
  for (let i = 0; i < 2; i++) {
    const result = run();
    expect(result.status, result.stderr).toBe(0);
  }
  expect(state().prs).toHaveLength(1);
  expect(
    JSON.parse(git(fork, "show", "upstream/v0.3.6:.github/upstream-scriptc.json")).revision,
  ).toBe(sha);
  expect(git(fork, "rev-parse", "main")).toBe(base);
  expect(state().body).toContain(sha);
  expect(state().createArgs).toContain("--draft");
});
test("conflicting fork changes are left intact and still get a reviewable PR", () => {
  release();
  writeFileSync(join(work, "value"), "fork\n");
  git(work, "add", ".");
  git(work, "commit", "-m", "fork change");
  git(work, "push", "origin", "main");
  const base = git(work, "rev-parse", "HEAD");
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  expect(state().prs).toHaveLength(1);
  expect(git(fork, "rev-parse", "main")).toBe(base);
  expect(git(fork, "show", "main:value")).toBe("fork");
  expect(git(fork, "show", "upstream/v0.3.6:value")).toContain("<<<<<<<");
  expect(state().body).toContain("Resolve these conflicts:");
});
test("closed proposals are not reopened", () => {
  release();
  save({ ...state(), prs: [{ state: "closed", number: 1 }] });
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  expect(state().createArgs).toBeUndefined();
});
test("a moved upstream tag fails without replacing the existing proposal", () => {
  release();
  expect(run().status).toBe(0);
  const sha = git(fork, "rev-parse", "upstream/v0.3.6");
  writeFileSync(join(upstream, "value"), "moved\n");
  git(upstream, "add", ".");
  git(upstream, "commit", "-m", "move");
  git(upstream, "tag", "-f", "v0.3.6");
  const result = run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("changed");
  expect(git(fork, "rev-parse", "upstream/v0.3.6")).toBe(sha);
  expect(state().prs).toHaveLength(1);
});
test("API failures surface instead of being treated as no update", () => {
  save({ ...state(), fail: true });
  const result = run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("GitHub API failed");
});

test.each([false, true])("human conflict resolution remains valid (merged: %s)", (merged) => {
  writeFileSync(join(work, "value"), "fork\n");
  git(work, "add", ".");
  git(work, "commit", "-m", "fork change");
  git(work, "push", "origin", "main");
  release();
  expect(run().status).toBe(0);
  git(work, "fetch", "origin");
  git(work, "checkout", "-b", "resolve", "origin/upstream/v0.3.6");
  expect(readFileSync(join(work, "value"), "utf8")).toContain("<<<<<<<");
  writeFileSync(join(work, "value"), "resolved\n");
  git(work, "add", ".");
  git(work, "commit", "-m", "resolve conflict");
  git(work, "push", "origin", "HEAD:upstream/v0.3.6");
  const resolved = git(work, "rev-parse", "HEAD");
  git(work, "checkout", "main");
  if (merged) {
    git(work, "merge", "--no-ff", "resolve", "-m", "merge upstream");
    git(work, "push", "origin", "main");
    save({ ...state(), prs: state().prs.map((pr: object) => ({ ...pr, state: "closed" })) });
  }
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  expect(git(fork, "rev-parse", "upstream/v0.3.6")).toBe(resolved);
  expect(state().prs).toHaveLength(1);
});

test("published release imports preserve fork workflows and record the upstream revision", () => {
  mkdirSync(join(work, ".github/workflows"), { recursive: true });
  writeFileSync(join(work, ".github/workflows/ci.yml"), "name: Fork CI\n");
  git(work, "add", ".");
  git(work, "commit", "-m", "fork workflow");
  git(work, "push", "origin", "main");
  mkdirSync(join(upstream, ".github/workflows"), { recursive: true });
  writeFileSync(join(upstream, ".github/workflows/ci.yml"), "name: Upstream CI\n");
  const sha = release();
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  expect(git(fork, "show", "upstream/v0.3.6:.github/workflows/ci.yml")).toBe("name: Fork CI");
  expect(JSON.parse(git(fork, "show", "upstream/v0.3.6:.github/upstream-scriptc.json"))).toEqual({
    revision: sha,
    version: "v0.3.6",
  });
  expect(state().createArgs).toContain("--draft");
});

test("the next release applies only its delta after a reviewed import", () => {
  release();
  expect(run().status).toBe(0);
  git(work, "checkout", "main");
  git(work, "merge", "--no-ff", "upstream/v0.3.6", "-m", "reviewed import");
  writeFileSync(join(work, "fork-only"), "retain this\n");
  git(work, "add", ".");
  git(work, "commit", "-m", "fork change after import");
  git(work, "push", "origin", "main");
  const sha = release("v0.3.7", "next release\n");
  save({ ...state(), prs: [] });
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  expect(git(fork, "show", "upstream/v0.3.7:value")).toBe("next release");
  expect(git(fork, "show", "upstream/v0.3.7:fork-only")).toBe("retain this");
  expect(
    JSON.parse(git(fork, "show", "upstream/v0.3.7:.github/upstream-scriptc.json")).revision,
  ).toBe(sha);
});

test("a branch published before PR creation is reused without replacing commits", () => {
  release();
  expect(run().status).toBe(0);
  const proposed = git(fork, "rev-parse", "upstream/v0.3.6");
  save({ ...state(), prs: [] });
  git(work, "checkout", "main");
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  expect(git(fork, "rev-parse", "upstream/v0.3.6")).toBe(proposed);
  expect(state().prs).toHaveLength(1);
});

test("unreleased commits on upstream main are never imported", () => {
  const sha = release();
  writeFileSync(join(upstream, "unreleased"), "must stay upstream\n");
  git(upstream, "add", ".");
  git(upstream, "commit", "-m", "unreleased main change");
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  expect(git(fork, "show", "upstream/v0.3.6:value")).toBe("upstream");
  expect(git(fork, "ls-tree", "--name-only", "upstream/v0.3.6")).not.toContain("unreleased");
  expect(
    JSON.parse(git(fork, "show", "upstream/v0.3.6:.github/upstream-scriptc.json")).revision,
  ).toBe(sha);
});

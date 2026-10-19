#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const upstream = "vercel-labs/scriptc";
const repository = process.env.GITHUB_REPOSITORY;
if (repository !== "zshannon/scriptc")
  throw new Error("upstream sync must run in zshannon/scriptc");
const run = (command, args) =>
  execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const api = (path, args = []) => JSON.parse(run("gh", ["api", path, ...args]));
const release = api(`repos/${upstream}/releases/latest`);
const tag = release.tag_name;
if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(tag))
  throw new Error("expected a published upstream full release");

run("git", ["fetch", "--no-tags", `https://github.com/${upstream}.git`, `refs/tags/${tag}`]);
const commit = run("git", ["rev-parse", "FETCH_HEAD^{commit}"]);
const branch = `upstream/${tag}`;
const statePath = ".github/upstream-scriptc.json";
const imported = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : null;
const proposals = api(`repos/${repository}/pulls`, [
  "--method",
  "GET",
  "-f",
  "state=all",
  "-f",
  `head=${repository.split("/")[0]}:${branch}`,
  "-f",
  "per_page=100",
]);
const proposedCommit = proposals[0]?.body?.match(/^Upstream commit: ([a-f0-9]{40})$/m)?.[1];
if (proposedCommit !== undefined && proposedCommit !== commit)
  throw new Error(`upstream tag changed: ${tag}; expected ${proposedCommit}, found ${commit}`);
if (imported?.version === tag && imported.revision !== commit)
  throw new Error(`upstream tag changed or baseline is not the exact release: ${tag}`);
const included = spawnSync(
  "git",
  ["merge-base", "--is-ancestor", commit, imported?.revision ?? "HEAD"],
  {
    encoding: "utf8",
  },
);
if (included.status === 0) {
  console.log(`${tag} is already included`);
} else {
  if (included.status !== 1)
    throw new Error(included.stderr || "could not inspect upstream ancestry");
  if (imported?.version === tag)
    throw new Error(`upstream tag changed: ${tag}; not contained in ${imported.revision}`);
  if (proposals.length) {
    console.log(`${tag} already has an open or closed proposal; leaving it unchanged`);
  } else {
    const forkBase = run("git", ["rev-parse", "HEAD"]);
    const previous = run("git", ["ls-remote", "--heads", "origin", `refs/heads/${branch}`]).split(
      /\s/,
    )[0];
    const temporary = mkdtempSync(join(tmpdir(), "scriptc-upstream-pr-"));
    try {
      let conflicts = "";
      if (previous) {
        run("git", ["fetch", "--no-tags", "origin", `refs/heads/${branch}`]);
        const recorded = JSON.parse(run("git", ["show", `${previous}:${statePath}`]));
        if (recorded.revision !== commit)
          throw new Error(`upstream tag or proposal branch changed: ${tag}`);
      } else {
        if (run("git", ["status", "--porcelain"]))
          throw new Error("upstream import requires a clean checkout");
        const baseline = imported?.revision ?? run("git", ["merge-base", "HEAD", commit]);
        // Match zshannon/yswift: import source, retaining fork-owned workflows.
        // The built-in token never needs permission to replace workflow files.
        const patch = execFileSync(
          "git",
          ["diff", "--binary", baseline, commit, "--", ".", ":(exclude).github/workflows"],
          { maxBuffer: 64 * 1024 * 1024 },
        );
        run("git", ["checkout", "-b", branch]);
        if (patch.length) {
          const patchPath = join(temporary, "upstream.patch");
          writeFileSync(patchPath, patch);
          const applied = spawnSync("git", ["apply", "--3way", "--index", patchPath], {
            encoding: "utf8",
          });
          conflicts = run("git", ["diff", "--name-only", "--diff-filter=U"]);
          if (applied.status !== 0 && !conflicts)
            throw new Error(applied.stderr || "could not apply upstream release");
        }
        run("git", ["diff", "--quiet", "HEAD", "--", ".github/workflows"]);
        mkdirSync(".github", { recursive: true });
        writeFileSync(
          statePath,
          JSON.stringify({ revision: commit, version: tag }, null, 2) + "\n",
        );
        run("git", ["add", "--all"]);
        run("git", [
          "-c",
          "user.name=github-actions[bot]",
          "-c",
          "user.email=41898282+github-actions[bot]@users.noreply.github.com",
          "commit",
          "-m",
          `Import upstream ${tag}`,
        ]);
        run("git", ["push", "origin", `HEAD:refs/heads/${branch}`]);
      }
      const body = join(temporary, "body.md");
      writeFileSync(
        body,
        `Import [${tag}](https://github.com/${upstream}/releases/tag/${tag}).\n\nUpstream commit: ${commit}\nFork base: ${forkBase}\n\nFork-owned CI workflows are retained. The recorded upstream revision tracks this source import.\n\n${conflicts ? `Resolve these conflicts:\n\n${conflicts}\n\n` : ""}Review the changes and run CI before merging this draft. This PR does not publish a fork release.\n`,
      );
      console.log(
        run("gh", [
          "pr",
          "create",
          "--repo",
          repository,
          "--base",
          "main",
          "--head",
          branch,
          "--draft",
          "--title",
          `Update upstream to ${tag}`,
          "--body-file",
          body,
        ]),
      );
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
}

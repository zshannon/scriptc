# Releasing the fork

This fork publishes the JavaScript API as `@zshannon/scriptc-compiler`, together with `@zshannon/scriptc-runtime` and matching `@zshannon/scriptc-llvm-*` / `@zshannon/scriptc-runtime-*` packages. It uses ordinary versions such as `0.3.6` and tags such as `v0.3.6`. Compiler, helper and runtime versions must match exactly. The unchanged `@scriptc/types`, `@scriptc/threads` and `@scriptc/experimental` language packages remain upstream-owned.

The JavaScript API is the distribution entry point. Native CLI self-hosting is not required for fork releases. The existing builders produce the platform artifacts; `pnpm pack` produces the installable bundles. The GitHub release carries those same tarballs, `SHA256SUMS` and `surface-manifest.json`.

## Consumer contract

Use the compiler's existing `compile` or `compileLibrary` JavaScript exports. Keep the compiler and runtime packages pinned to the same version. `compileLibrary({ profilePath, outDir })` consumes a normal library profile and returns the native archive path. The mobile target identifiers are `aarch64-apple-ios` and `aarch64-apple-ios-simulator` through `SCRIPTC_TARGET`; native macOS uses the default target. Consumers install the prebuilt artifacts and do not rebuild or patch the compiler.

The optional `ScriptCJavaScriptCore` SwiftPM product is exposed by the root `Package.swift`. A consuming package can use `.package(url: "https://github.com/zshannon/scriptc.git", from: "0.3.6")` after that tag is published. Link it alongside the matching archive produced by `compileLibrary`. Its shipping target uses package-relative headers and standard SwiftPM ARC settings. The nested `packages/jsc` manifest is the lifetime-test harness; its `SCRIPTC_RUNTIME_LIBRARY` setting is not a shipping dependency. See [the adapter contract](packages/jsc/README.md).

## Release setup and procedure

1. Configure the GitHub `Release` environment and npm publishing access for the fork's package names. The existing workflow uses npm trusted publishing with repository `zshannon/scriptc`, calling workflow `fork-ci.yml` and environment `Release`. New npm packages need their initial registration and publisher configuration before this workflow can publish them.
2. Set the ordinary release version in `packages/cli/package.json`, then run `node scripts/sync-versions.mjs`, `pnpm install`, `pnpm manifest` and `pnpm node-compat`. The CLI manifest remains the existing version source even though the release delivers the JavaScript API.
3. Put the release notes between the single pair of release markers in `CHANGELOG.md`. Preserve the upstream base in the notes and require the applicable CI and packed-consumer checks to pass before release.
4. Merge the reviewed source to `main`. After all `Fork CI` checks pass for that commit, it calls `release.yml` automatically. A version with a completed GitHub release is skipped; bump the manifest version in the PR to release changed package contents. The publisher builds matching helpers and runtime packs, checks their versions, publishes dependencies before the compiler and creates the matching GitHub tag/release. Publication is restricted to `zshannon/scriptc` on `main`; PR runs never publish. To retry a partial release, re-run failed jobs on the original `Fork CI` run so publication uses its saved tarballs. A new manual run is suitable only before any package upload has been accepted.

PR checks use the self-hosted fleet. The npm publishing job uses a GitHub-hosted runner because npm trusted publishing requires one. Configure npm to trust `fork-ci.yml`, the caller, rather than the reusable `release.yml`.

Upload receipts include the candidate tarball SHA-512. Retries accept a registry conflict only when its integrity matches the candidate; an unverifiable staged upload fails until its matching receipt or registry integrity is available. Reuse a published version only for a retry of the identical release, never for changed package contents.

## First npm publication

npm trusted publishers require an existing package and an account with two-factor authentication. The first release therefore needs one manual publication of the real release tarballs; do not create placeholder versions. This workflow publishes 20 packages: the compiler, runtime source, seven LLVM helpers, and eleven platform runtime packs.

1. Merge the validated PR. Wait for `Fork CI` on `main` to build and save the `release-packages` artifact. Until npm is configured, the subsequent `Publish to npm` step can fail authentication; the complete artifact remains downloadable.
2. Download that run's `release-packages` artifact into a fresh local `release-packages` directory. Use Node 24 and npm 11.15 or newer, signed in as the package owner. These commands publish publicly; complete npm's browser/2FA prompts. Publish the dependencies first and the compiler last:

```bash
(
  for tarball in release-packages/*.tgz; do
    case "$tarball" in *scriptc-compiler-*) continue ;; esac
    npm publish "$tarball" --access public || exit 1
  done
  npm publish release-packages/zshannon-scriptc-compiler-0.3.6.tgz --access public
)
```

3. Configure the trusted publisher for every package in that same artifact. The first request requires npm's account confirmation. Its five-minute confirmation window can cover the loop:

```bash
for tarball in release-packages/*.tgz; do
  package_name=$(tar -xOf "$tarball" package/package.json | node -pe 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).name')
  npm trust github "$package_name" --repo zshannon/scriptc --file fork-ci.yml --env Release --allow-publish --yes || break
  sleep 2
done
```

4. Re-run the failed jobs on that same `Fork CI` run. It restores the saved tarballs instead of repacking. It accepts already-published packages only when their integrity matches the saved tarballs, then completes the GitHub release. Future new manifest versions publish automatically after the main checks pass.

The equivalent npm website settings are GitHub Actions, owner `zshannon`, repository `scriptc`, workflow `fork-ci.yml`, environment `Release`, and permission to publish directly. No npm token or additional GitHub secret is needed. See [npm trust prerequisites and bulk configuration](https://docs.npmjs.com/cli/v11/commands/npm-trust/) and [trusted publishing with reusable workflows](https://docs.npmjs.com/trusted-publishers/).

## Weekly upstream updates

`sync-upstream.yml` runs weekly on Monday and can also be dispatched manually. It uses the built-in `GITHUB_TOKEN` with Contents and Pull requests write permissions, Enable GitHub Actions and the repository setting allowing Actions to create pull requests; no personal token or additional secret is required.

The recorded baseline must be the exact released tag commit, never a later main commit. The action reads the latest published full release from `vercel-labs/scriptc` and opens one draft PR from `upstream/<tag>` when that source is not already imported. It applies the source delta with Git three-way merging, retains fork-owned `.github/workflows`, and records the imported revision in `.github/upstream-scriptc.json`. Text conflicts are listed in the draft for review; structural conflicts that Git cannot apply stop the action visibly. It never force-pushes or merges and does not recreate an open or closed proposal. API failures and changed proposal tags fail visibly. Review workflow changes separately, resolve source conflicts, and run CI before merging; PRs created by the built-in token require a maintainer to approve the resulting workflow runs in GitHub. Consumers update their pinned dependency separately.

GitHub schedules run on the default branch and may be disabled after 60 days without repository activity. See [scheduled workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), [automation token behavior](https://docs.github.com/en/actions/concepts/security/github_token) and [npm trusted publishing](https://docs.npmjs.com/trusted-publishers).

## Pull request checks

`fork-ci.yml` runs on pull requests, pushes to `main`, and manual dispatch. It uses the existing self-hosted `ubuntu-noble-lg` and `macos-xl` pools for build, lint, format, generated-source checks, compiler regressions, release/updater tests, native library regressions, and the 19 JSC lifetime cases in Release and AddressSanitizer configurations. External-fork code requires review before using these runners. The inherited upstream `ci.yml` remains disabled in this fork; these focused checks do not certify its full Intel, Linux, Windows, or bootstrap matrix.

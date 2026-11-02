# Releasing the fork

<<<<<<< ours
This fork publishes the JavaScript API as `@zshannon/scriptc-compiler`, together with `@zshannon/scriptc-runtime`, the `@zshannon/scriptc-llvm-darwin-arm64` helper, and matching runtime packs for Apple Silicon macOS, iOS devices, and the iOS simulator. It uses ordinary versions such as `0.3.6` and tags such as `v0.3.6`. Compiler, helper and runtime versions must match exactly. The unchanged `@scriptc/types`, `@scriptc/threads` and `@scriptc/experimental` language packages remain upstream-owned.
=======
Releases are manual, single-commit affairs. The maintainer controls the changelog voice and format. `@scriptc/runtime`, every platform helper/runtime pack, `@scriptc/compiler`, `@scriptc/experimental`, `@scriptc/node`, `@scriptc/threads`, and `scriptc` always publish together at the same version.
>>>>>>> theirs

The JavaScript API is the distribution entry point. Native CLI self-hosting is not required for fork releases. The existing builders produce the platform artifacts; `pnpm pack` produces the installable bundles. The GitHub release carries those same tarballs, `SHA256SUMS` and `surface-manifest.json`.

<<<<<<< ours
## Consumer contract
=======
1. Bump the version in `packages/cli/package.json`
2. Run `node scripts/sync-versions.mjs` to stamp the same version into the runtime, helper, compiler, experimental, node, and threads packages, then `pnpm manifest` to restamp `packages/compiler/surface-manifest.json` with the new version, and commit both (the test suite's staleness guard fails on a version drift)
3. Fold the `## Unreleased` section of `CHANGELOG.md` into a new `## <version>` entry (newest first, below `## Unreleased`), and leave `## Unreleased` empty for the next cycle
4. Wrap the new entry in `<!-- release:start -->` and `<!-- release:end -->` markers; this marked block is also the GitHub release body
5. Remove the `<!-- release:start -->` and `<!-- release:end -->` markers from the previous release entry; only the latest release should have markers
6. With Zig on `PATH`, run `SCRIPTC_CROSS=1 pnpm exec vitest run tests/harness/library-cross.test.ts` and require the cross-target library conformance lane to pass
7. Refresh the runtime profile on a quiet Linux x64 host: `node scripts/refresh-runtime-profile.mjs --tsc-ts <tsc-ts checkout> --project <TypeORM>:tsconfig.bench.json --project <T3 server>:tsconfig.bench.json --project <VS Code>/src:tsconfig.bench.json`, and include the new `packages/runtime-pack-common/profiles/linux-x64-gnu.profdata.gz` (see the runtime profile paragraph below)
8. Commit to `main`
>>>>>>> theirs

Use the compiler's existing `compile` or `compileLibrary` JavaScript exports. Keep the compiler and runtime packages pinned to the same version. `compileLibrary({ profilePath, outDir })` consumes a normal library profile and returns the native archive path. The mobile target identifiers are `aarch64-apple-ios` and `aarch64-apple-ios-simulator` through `SCRIPTC_TARGET`; native macOS uses the default target. Consumers install the prebuilt artifacts and do not rebuild or patch the compiler.

<<<<<<< ours
The optional `ScriptCJavaScriptCore` SwiftPM product is exposed by the root `Package.swift`. A consuming package can use `.package(url: "https://github.com/zshannon/scriptc.git", from: "0.3.6")` after that tag is published. Link it alongside the matching archive produced by `compileLibrary`. Its shipping target uses package-relative headers and standard SwiftPM ARC settings. The nested `packages/jsc` manifest is the lifetime-test harness; its `SCRIPTC_RUNTIME_LIBRARY` setting is not a shipping dependency. See [the adapter contract](packages/jsc/README.md).

## Release setup and procedure

1. Configure the GitHub `Release` environment and npm publishing access for the fork's package names. The existing workflow uses npm trusted publishing with repository `zshannon/scriptc`, calling workflow `fork-ci.yml` and environment `Release`. New npm packages need their initial registration and publisher configuration before this workflow can publish them.
2. Set the ordinary release version in `packages/cli/package.json`, then run `node scripts/sync-versions.mjs`, `pnpm install`, `pnpm manifest` and `pnpm node-compat`. The CLI manifest remains the existing version source even though the release delivers the JavaScript API.
3. Put the release notes between the single pair of release markers in `CHANGELOG.md`. Preserve the upstream base in the notes and require the applicable CI and packed-consumer checks to pass before release.
4. Merge the reviewed source to `main`. After all `Fork CI` checks pass for that commit, it calls `release.yml` automatically. A version with a completed GitHub release is skipped; bump the manifest version in the PR to release changed package contents. The publisher builds matching helpers and runtime packs, checks their versions, publishes dependencies before the compiler and creates the matching GitHub tag/release. Publication is restricted to `zshannon/scriptc` on `main`; PR runs never publish. To retry a partial release, re-run failed jobs on the original `Fork CI` run so publication uses its saved tarballs. A new manual run is suitable only before any package upload has been accepted.

PR checks use the self-hosted fleet. The npm publishing job uses a GitHub-hosted runner because npm trusted publishing requires one. Configure npm to trust `fork-ci.yml`, the caller, rather than the reusable `release.yml`.

Upload receipts include the candidate tarball SHA-512. Retries accept a registry conflict only when its integrity matches the candidate; an unverifiable staged upload fails until its matching receipt or registry integrity is available. Reuse a published version only for a retry of the identical release, never for changed package contents.

## First npm publication

The initial local release is `0.3.5`; merging the PR at `0.3.6` produces the next release through GitHub Actions. Both releases contain six packages: the compiler, runtime source, Apple Silicon macOS LLVM helper, and runtime packs for Apple Silicon macOS, iOS devices, and the iOS simulator. The release workflow does not build or publish other platforms.

Build the initial packages locally at `0.3.5`, pack them with `pnpm pack`, verify a clean consumer can compile all three targets, and publish the five dependencies before the compiler. Restore the checked-in manifests and generated surface manifest to `0.3.6` afterward so the merge triggers a distinct release. Keep the actual `0.3.5` tarballs and their checksums for the release record.

Configure npm trusted publishing for each of the six packages with GitHub Actions, owner `zshannon`, repository `scriptc`, calling workflow `fork-ci.yml`, environment `Release`, and direct publish permission. Use `npm trust github <package> --repo zshannon/scriptc --file fork-ci.yml --env Release --allow-publish --yes` from the authenticated maintainer account and complete npm's browser/2FA confirmation. No npm token or additional GitHub secret is needed.

A new trusted-publisher configuration must complete its first successful automated publish within two days of configuration. This is an expiry deadline, not a requirement to wait or publish on separate days. Merge `0.3.6` within that window. If the configuration expires before use, delete and recreate it before publishing. See [npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/) and [trusted-publisher expiry](https://docs.npmjs.com/trusted-publishers/#trusted-publisher-configuration-expiry).

If a release is interrupted after any upload, re-run failed jobs on that same `Fork CI` run. It restores the saved tarballs instead of repacking and accepts already-published packages only when their integrity matches. Future new manifest versions publish automatically after main checks pass.

## Weekly upstream updates

`sync-upstream.yml` runs weekly on Monday and can also be dispatched manually. It uses the built-in `GITHUB_TOKEN` with Contents and Pull requests write permissions, Enable GitHub Actions and the repository setting allowing Actions to create pull requests; no personal token or additional secret is required.

The recorded baseline must be the exact released tag commit, never a later main commit. The action reads the latest published full release from `vercel-labs/scriptc` and opens one draft PR from `upstream/<tag>` when that source is not already imported. It applies the source delta with Git three-way merging, retains fork-owned `.github/workflows`, and records the imported revision in `.github/upstream-scriptc.json`. Text conflicts are listed in the draft for review; structural conflicts that Git cannot apply stop the action visibly. It never force-pushes or merges and does not recreate an open or closed proposal. API failures and changed proposal tags fail visibly. Review workflow changes separately, resolve source conflicts, and run CI before merging; PRs created by the built-in token require a maintainer to approve the resulting workflow runs in GitHub. Consumers update their pinned dependency separately.

GitHub schedules run on the default branch and may be disabled after 60 days without repository activity. See [scheduled workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), [automation token behavior](https://docs.github.com/en/actions/concepts/security/github_token) and [npm trusted publishing](https://docs.npmjs.com/trusted-publishers).

## Pull request checks

`fork-ci.yml` runs on pull requests, pushes to `main`, and manual dispatch. It uses the existing self-hosted `ubuntu-noble-lg` and `macos-xl` pools for build, lint, format, generated-source checks, compiler regressions, release/updater tests, native library regressions, and the 22 JSC lifetime cases in Release and AddressSanitizer configurations. External-fork code requires review before using these runners. The inherited upstream `ci.yml` is manual-only in this fork; these focused checks do not certify its full Intel, Linux, Windows, or bootstrap matrix.
=======
The release job builds each pinned LLVM helper, precompiled runtime pack, and native CLI on its matching host. The native CLI package bundles its TypeScript checker, declarations, and comptime evaluator, and depends on its platform's LLVM helper and runtime pack packages at the same version; the compiler resolves them beside itself. The standalone archives bundle the helper and runtime pack too. npm postinstall installs the matching native executable; Node is needed for npm installation but not native compilation or execution. The user's toolchain performs the final platform link. Sanitized builds also use it to instrument program LLVM and compile the C runtime. Platform packages publish ahead of `@scriptc/compiler` and `scriptc`. The GitHub release attaches standalone compiler archives, their SHA-256 checksums, and the surface manifest after npm publication succeeds.

Release builds of the native CLI optimize the compiler with a profile collected on the release commit. The `cli-profile` job runs `node scripts/refresh-cli-profile.mjs` on Linux x64, which builds an instrumented compiler, runs it on tsc-ts, a slice of the corpus, and the runtime benchmark workloads, and writes the merged profile. The profile keeps the functions that training never ran, with zero counts, so the CLI builds optimize them as cold code and place them after the code that ran. Every platform's CLI build uses that profile (`SCRIPTC_NATIVE_PROFILE_USE`), and the GitHub release attaches it as `scriptc-<version>-cli.profdata.gz`. Code the profile does not describe, or describes from older compiler sources, is optimized as without a profile. When the profile job fails, the CLI builds use the committed profile `packages/compiler/native/cli.profdata.gz`, which local and CI builds of the native compiler also use. Refresh the committed profile when compiler code has changed substantially since the last refresh: run `node scripts/refresh-cli-profile.mjs --tsc-ts <tsc-ts checkout>` on a quiet Linux x64 host and commit the new profile on its own.

Builds of the native compiler also order its functions by the committed layout `packages/compiler/native/cli.layout.gz`: the functions that `--version` and rebuilds of unchanged programs run come first, then the ones other builds run, ordered by the share of the layout's training builds that run each, so a run maps fewer pages of the executable. Functions the layout does not list keep their usual order. Function names of closures and generated helpers change with nearby edits, so the `cli-profile` job also collects a layout on the release commit (`scripts/refresh-cli-layout.mjs`), and the CLI builds use it (`SCRIPTC_NATIVE_LAYOUT`). Instrumented builds use the same layout as optimized builds, because a function laid out in a different partition than in the instrumented build no longer matches its profile record. The job therefore collects the layout first and then builds the instrumented compiler for the profile with that layout. Refresh the committed layout the same way, with `node scripts/refresh-cli-layout.mjs`, before the profile, and commit each on its own.

The Linux x64 runtime pack optimizes its speed-flavor units with the committed runtime profile `packages/runtime-pack-common/profiles/linux-x64-gnu.profdata.gz`. Runtime functions whose code changed since the profile was collected are optimized as without a profile. The pack manifest records how the profile matched (`flavors.speed.runtime_profile`): the matched and changed functions, and the share of the profile's counts on changed functions. `packages/runtime-pack-common/test/runtime-profile.test.ts` fails when changed functions hold more than 5% of the counts, and names the functions with the most counts. Refresh the profile in each release commit (step 7), and between releases when that test fails.

Publishing uses npm trusted publishing (OIDC) — there is no npm token secret.
Each published package must have a GitHub Actions trusted publisher for
`release.yml` and the `Release` environment. A missing configuration fails
before upload. Re-runs skip package versions already present on npm, so a
partially published release can be resumed safely.

## libnode packs

The `@scriptc/libnode-<platform>` packs (linux-x64-gnu, linux-arm64-gnu, darwin-arm64, darwin-x64) carry the Node.js shared library that programs with Node islands load in process, plus the scriptc bridge compiled against it. They version in lockstep with the other platform packages (`sync-versions.mjs` stamps them); the Node release they contain is pinned separately in `packages/libnode-common/libnode.json`, which must match `.node-version` and `internal/compatibility/node-v24.json`. Each pack's `manifest.json` records the Node version, `NODE_MODULE_VERSION`, the bridge ABI and the size and SHA-256 of both libraries.

A Node `--shared` build takes about half an hour on 8 cores, so packs never build in `pnpm -r build`, the test suites or the release job. `.github/workflows/libnode-packs.yml` builds them on matching hosts when the pin, the bridge (`packages/libnode-common/bridge/`, `packages/runtime/src/scr_node_bridge.h`) or the pack packages change, or on manual dispatch. Linux packs build in the `manylinux_2_28` images (glibc 2.28, gcc-toolset-14) on native x64 and arm64 runners; Node disables its startup snapshot when cross-compiling, so arm64 is never cross-built. Each platform's libnode build is cached by Node release, configure flags, platform and toolchain; a bridge-only change restores libnode from the cache and rebuilds only the bridge. Every pack is smoke-tested by `packages/libnode-common/smoke/smoke.c`, which loads it the way the runtime does, and uploaded as the `libnode-<platform>` artifact, with zstd copies of both libraries as `libnode-<platform>-zst`. The Linux x64 and macOS test lanes of `ci.yml` restore the cached build for their platform through `.github/actions/libnode`, assemble the pack (`build.mjs --from-cache`, which never builds Node) and set `SCRIPTC_LIBNODE`, so the Node island tests run; without a cached build they fall back to the pinned development pack (`packages/libnode-common/dev-pack.json`). `packages/libnode-common/build-pack.mjs` assembles a pack from any matching libnode and headers, the bridge-only rebuild path.

To build one pack by hand on its own platform (it needs Python 3.9+, Ninja, a C++20 compiler and zstd; on Linux, build in a manylinux_2_28 container for a distributable pack):

```bash
pnpm --filter @scriptc/libnode-linux-x64-gnu build:native
node packages/libnode-common/scripts/verify.mjs packages/libnode-linux-x64-gnu
node packages/libnode-common/scripts/smoke.mjs
```

The packs are `private` until the in-process Node island runtime ships. Publishing them then means removing `private`, configuring their npm trusted publishers, and having the release job download the `libnode-<platform>` artifacts of the workflow run for the release commit (or call the workflow, which restores every platform from its cache) and publish them with the other platform packages.
>>>>>>> theirs

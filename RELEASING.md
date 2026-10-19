# Releasing the fork

This fork publishes the JavaScript API as `@zshannon/scriptc-compiler`, together with `@zshannon/scriptc-runtime`, the `@zshannon/scriptc-llvm-darwin-arm64` helper, and matching runtime packs for Apple Silicon macOS, iOS devices, and the iOS simulator. It uses ordinary versions such as `0.3.6` and tags such as `v0.3.6`. Compiler, helper and runtime versions must match exactly. The unchanged `@scriptc/types`, `@scriptc/threads` and `@scriptc/experimental` language packages remain upstream-owned.

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

`fork-ci.yml` runs on pull requests, pushes to `main`, and manual dispatch. It uses the existing self-hosted `ubuntu-noble-lg` and `macos-xl` pools for build, lint, format, generated-source checks, compiler regressions, release/updater tests, native library regressions, and the 19 JSC lifetime cases in Release and AddressSanitizer configurations. External-fork code requires review before using these runners. The inherited upstream `ci.yml` remains disabled in this fork; these focused checks do not certify its full Intel, Linux, Windows, or bootstrap matrix.

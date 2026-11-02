<<<<<<< ours
/* npm packages compiled natively: every program under tests/fixtures/npm/cases
 * (plus the commander fixtures in npm-cases.ts) builds with the default
 * static npm compile and runs against Node. A case matches Node (stdout and
 * exit status for every argv list, stderr when it opts in with
 * `// @stderr`) unless KNOWN records how it differs:
 *
 * - build: the compile refuses it with this diagnostic code;
 * - run: it compiles, and the program's output names this diagnostic code
 *   (a refusal deferred to the operation that reached it), for every argv
 *   list or for the listed `argvs`, while the other lists match Node;
 * - divergence: it runs but does not match Node yet. These run as expected
 *   failures, so a fix that makes one match fails here until KNOWN drops it.
 *
 * The fixture node_modules are committed test data. Binaries compile the
 * package sources at build time and read nothing from node_modules at run
 * time.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { globSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { compile } from "@zshannon/scriptc-compiler";
import { npmCases, type NpmCase } from "./npm-cases.js";
import { shardSelect, shardSuffix } from "./shard.js";
=======
/* npm packages compiled natively as built by default (npm-suite.ts). */
import { defineNpmSuite } from "./npm-suite.js";
>>>>>>> theirs

defineNpmSuite({ label: "npm native" });

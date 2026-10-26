/** External program-object ABI identity. The spelling is intentionally part
 * of the link contract: a program object keeps this symbol undefined and the
 * matching runtime defines it, so incompatible manual links fail before the
 * program can start. */
<<<<<<< ours
export const RUNTIME_ABI_VERSION = 1 as const;
export const RUNTIME_ABI_MARKER = "scr_zshannon_runtime_abi_v1" as const;
=======
export const RUNTIME_ABI_VERSION = 45 as const;
export const RUNTIME_ABI_MARKER = "scr_runtime_abi_v45" as const;
>>>>>>> theirs

/** Object consumption is useful today, but the complete scr_* surface may
 * still change before 1.0. The versioned marker prevents accidental mixing;
 * it does not promise semver stability yet. */
export const EXTERNAL_OBJECT_ABI_STABILITY = "experimental" as const;

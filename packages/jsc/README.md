# ScriptCJavaScriptCore

An optional Apple-platform adapter for a ScriptC native library embedded in JavaScriptCore. Link the `ScriptCJavaScriptCore` SwiftPM product alongside the matching native ScriptC archive. The compiler and ordinary runtime do not import or link JavaScriptCore.

## Ownership contract

ScriptC's ordinary native allocator, reference counting, and cycle collector own native objects. The adapter performs no native graph discovery, reference-count classification, ownership reporting, or managed-edge publication. A native Foreign handle protects its JavaScript value once until detach. Each JavaScript wrapper owns one native reference. Native aliases and field changes use ordinary native memory management without notifying the adapter.

Strong cycles spanning both heaps require explicit application lifecycle cleanup. For example, when a native object owns a JS callback that retains a wrapper back to that native object, clear one of those ownership edges when the component or session ends. The adapter does not promise automatic collection of arbitrary mixed native/JS cycles. Native-only cycles remain the existing native collector's responsibility.

## Host lifecycle

1. Create one adapter for a runtime instance on its owning thread. Bracket compiled entries and JS-to-native callbacks with `scr_jsc_enter`/`scr_jsc_leave`, including nested calls. The outer leave drains finalized native references, invokes the native collector's existing schedule, and releases temporary JS roots. It does not request JSC collection or force a full native collection. The embedding host continues to service the VM's run loop normally.
2. Use `scr_jsc_keep` for temporary JS values stored in C memory, including strings and argument arrays. They remain protected until the outer leave or synchronization outside a native turn. Weak identity lookup results obtained during a turn receive the same temporary protection.
3. Call `scr_jsc_attach_foreign` once for a native-owned foreign JS value, and `scr_jsc_detach_foreign` before the native handle dies. Native reference counting owns that handle's lifetime; the adapter does not inspect its reference count or children.
4. For a JS-owned native value, create a JS object whose class uses `scr_jsc_finalize`, then call `scr_jsc_attach_native`. The adapter reserves its private pointer and owns one native reference for that wrapper. Identity caches are weak. Register an array facade with `scr_jsc_set_facade` when applicable.
5. Finalizers only enqueue notifications behind a mutex. They do not release native allocations or call context-taking JSC APIs. The owner thread drains releases at the next boundary or explicit synchronization. A finalized wrapper does not force a full native cycle pass. Late finalizers after adapter disposal only free their detached notification storage.
6. Break application mixed-cycle edges and release native application roots before disposal. The optional profile `abi.dispose_symbol` releases and zeros compiled globals, clears runtime session roots and runs ordinary native cycle collection. Then `scr_jsc_dispose` releases wrapper-owned native references, requests a full native collection for shutdown, and requires all Foreign handles to be gone. Release the JS context afterward. Reinitialization retains the full empty-heap audit after the host releases its references.

`ScrDynForeignOps.traced` remains available when a foreign referent participates in an ordinary native cycle: its native trace/free callbacks must obey the existing native collector contract. This does not enable adapter graph tracking. The compiler and runtime use ordinary native ownership; the removed experimental profile modes are rejected when enabled.

`scr_jsc_create_with_runtime` accepts opaque provider identities and consumes only `retain`, `release`, and `collect`. `collect(false)` follows the provider's schedule; `collect(true)` requests shutdown collection. The callback table is copied and the provider context is borrowed through disposal. Provider operations run on the owning thread.

## Verification

The 22 Swift Testing cases cover native and JS ownership, native cycles, field replacement and aliases, native ownership through forced JS GC, explicit mixed-cycle cleanup over 100 iterations, queued finalization, disposal before late finalization, scoped strings and facades, identity-cache replacement, lookup scaling across unrelated wrappers, expired-facade fallback, middle-alias removal, shared native children, duplicate-edge removal, growing native containers, and opaque handles with zero adapter graph queries. Their fixture uses `JSSynchronousGarbageCollectForDebugging` only through a test header. The shipping target does not reference that private API.

Run `node scripts/test-jsc.mjs` after building the workspace and native packages. It compiles a synthetic library with the public JavaScript API and runs the 22 lifetime cases against that archive. Set `SCRIPTC_SAN=1` to instrument both the archive and Swift package with AddressSanitizer. No application source is required.

#ifndef SCRIPTC_JAVASCRIPT_CORE_H
#define SCRIPTC_JAVASCRIPT_CORE_H
#include <JavaScriptCore/JavaScriptCore.h>
#include <stdbool.h>
#include <stddef.h>

typedef struct ScrDyn ScrDyn;
typedef struct ScrJSC ScrJSC;

/* Opaque native identities. collect(false) follows the native runtime
 * schedule; collect(true) is used at disposal. Callbacks run on the owning
 * thread. The copied operations and borrowed runtime_context remain valid
 * until scr_jsc_dispose returns. */
typedef struct {
  void *(*retain)(void *context, void *object);
  void (*release)(void *context, void *object);
  void (*collect)(void *context, bool full);
} ScrJSCRuntimeOps;

/* Boundary ownership only. Original native RC/CC owns native objects; no
 * native graph, RC classification or ownership reporting is performed here.
 * Enter/leave brackets native execution and scopes temporary JS roots.
 * Arbitrary native/JS strong cycles require application lifecycle cleanup. */
ScrJSC *scr_jsc_create(JSGlobalContextRef context);
ScrJSC *scr_jsc_create_with_runtime(JSGlobalContextRef context,
    const ScrJSCRuntimeOps *operations, void *runtime_context);
void scr_jsc_enter(ScrJSC *state);
void scr_jsc_leave(ScrJSC *state);
void scr_jsc_sync(ScrJSC *state);
/* Root a temporary value stored in native memory until the outer leave/sync.
 * This also covers strings and array facades used as native call arguments. */
void scr_jsc_keep(ScrJSC *state, JSValueRef value);
void scr_jsc_dispose(ScrJSC *state);

/* Each foreign handle owns one protected JS value until detach, independent
 * of ordinary native RC changes. Detach precedes freeing the native handle. */
void scr_jsc_attach_foreign(ScrJSC *state, void *native, JSValueRef value);
void scr_jsc_detach_foreign(ScrJSC *state, void *native);
JSValueRef scr_jsc_foreign_value(ScrJSC *state, void *native);

/* A JS wrapper owns exactly one native +1. Identity caches are weak.
 * Register before exposing wrapper. A facade (e.g. array Proxy) may be
 * associated afterward. The JSClass must use scr_jsc_finalize. */
void scr_jsc_attach_native(ScrJSC *state, const void *identity, ScrDyn *native, JSObjectRef wrapper);
void scr_jsc_set_facade(ScrJSC *state, JSObjectRef wrapper, JSValueRef facade);
JSValueRef scr_jsc_find_native(ScrJSC *state, const void *identity);
ScrDyn *scr_jsc_find_box(ScrJSC *state, JSValueRef value);
ScrDyn *scr_jsc_native_box(JSObjectRef wrapper);
void scr_jsc_finalize(JSObjectRef wrapper);

size_t scr_jsc_foreign_count(ScrJSC *state);
size_t scr_jsc_native_count(ScrJSC *state);
#endif

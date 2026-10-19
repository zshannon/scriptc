#import "LifetimeFixtures.h"
#import "ScriptCJavaScriptCore.h"
#import "JSContextGC.h"
#import <Foundation/Foundation.h>
#include "scr_runtime.h"
#include <pthread.h>
#include <stdio.h>

/* Invalid host addresses ensure only the provider interprets opaque handles. */
typedef struct {
  ScrJSC *state;
  size_t references[3], releases;
  size_t full_collections, scheduled_collections;
} OpaqueRuntime;
static size_t opaque_index(void *object) {
  size_t index = (uintptr_t)object; assert(index >= 1 && index <= 2); return index;
}
static void *opaque_retain(void *context, void *object) {
  OpaqueRuntime *runtime = context; runtime->references[opaque_index(object)]++; return object;
}
static void opaque_release(void *context, void *object) {
  OpaqueRuntime *runtime = context; size_t index = opaque_index(object);
  assert(runtime->references[index]); runtime->releases++;
  if (--runtime->references[index] == 0) {
    if (index == 1) {
      opaque_release(context, (void *)2); opaque_release(context, (void *)2);
    } else scr_jsc_detach_foreign(runtime->state, object);
  }
}
static void opaque_collect(void *context, bool full) {
  OpaqueRuntime *runtime = context;
  if (full) runtime->full_collections++; else runtime->scheduled_collections++;
}
typedef struct { size_t rc; ScrJSC *state; ScrDyn *child; } Foreign;
static size_t destroyed;
static void foreign_trace(void *object, ScrTraceVisit visit, void *context) {
  Foreign *value = object;
  if (value->child) visit(value->child, context);
}
static void foreign_free(void *object) {
  Foreign *value = object; scr_jsc_detach_foreign(value->state, value);
  destroyed++; scr_cyc_free(object);
}
static void *foreign_retain(void *object) {
  ((Foreign *)object)->rc++; return object;
}
static void foreign_release(void *object) {
  Foreign *value = object;
  if (--value->rc == 0) {
    scr_cyc_dead(value); ScrDyn *child = value->child; value->child = NULL;
    if (child) scr_dyn_release(child);
    foreign_free(value);
  } else {
    if (value->child) scr_cyc_released(value);
  }
}
/* Consumes the child, matching an ordinary native strong-field assignment. */
static void foreign_set_child(Foreign *owner, ScrDyn *child) {
  ScrDyn *old = owner->child; owner->child = child;
  if (old) scr_dyn_release(old);
}
static const ScrDynForeignOps operations = {
  .base = { .cls = "TestForeign", .retain = foreign_retain, .release = foreign_release }, .traced = true,
};
typedef struct { JSGlobalContextRef context; ScrJSC *state; JSClassRef cls; } Fixture;
static Fixture fixture(void) {
  destroyed = 0; scr_dyn_handle_install(SCR_DYNH_FOREIGN, &operations.base);
  Fixture f = { .context = JSGlobalContextCreate(NULL) }; f.state = scr_jsc_create(f.context);
  JSClassDefinition definition = kJSClassDefinitionEmpty; definition.finalize = scr_jsc_finalize;
  f.cls = JSClassCreate(&definition); return f;
}
static JSValueRef evaluate(Fixture f, const char *source) {
  JSStringRef text = JSStringCreateWithUTF8CString(source); JSValueRef exception = NULL;
  JSValueRef result = JSEvaluateScript(f.context, text, NULL, NULL, 1, &exception);
  JSStringRelease(text); assert(!exception); return result;
}
static ScrDyn *foreign(Fixture f, JSValueRef value) {
  static ScrCycType type = { foreign_trace, foreign_free, SCR_CYC_KIND_NONE };
  Foreign *item = scr_cyc_alloc(sizeof *item, &type); item->state = f.state; item->child = NULL;
  scr_jsc_attach_foreign(f.state, item, value); return scr_dyn_new_handle(item, SCR_DYNH_FOREIGN);
}
static JSObjectRef wrapper(Fixture f, ScrDyn *native) {
  JSObjectRef object = JSObjectMake(f.context, f.cls, NULL);
  scr_jsc_attach_native(f.state, native, native, object); return object;
}
static void property(Fixture f, JSObjectRef object, const char *name, JSValueRef value) {
  JSStringRef key = JSStringCreateWithUTF8CString(name);
  JSObjectSetProperty(f.context, object, key, value, 0, NULL); JSStringRelease(key);
}
static void collect(Fixture f) {
  for (int i = 0; i < 4; i++) {
    @autoreleasepool {
      JSSynchronousGarbageCollectForDebugging(f.context);
      scr_jsc_sync(f.state); scr_collect_cycles(); scr_jsc_sync(f.state);
    }
  }
}
static void finish(Fixture f) {
  evaluate(f, "globalThis.root=null;globalThis.alias=null;globalThis.cycleEndpoint=null"); collect(f);
  scr_jsc_dispose(f.state); JSGlobalContextRelease(f.context); JSClassRelease(f.cls);
}
__attribute__((noinline)) static void opaque_owned(Fixture f, OpaqueRuntime *runtime) {
  @autoreleasepool {
    scr_jsc_enter(f.state);
    scr_jsc_attach_foreign(f.state, (void *)2, evaluate(f, "({marker:42})"));
    JSObjectRef object = JSObjectMake(f.context, f.cls, NULL);
    scr_jsc_attach_native(f.state, (void *)1, (ScrDyn *)1, object);
    property(f, JSContextGetGlobalObject(f.context), "root", object);
    opaque_release(runtime, (void *)1); scr_jsc_leave(f.state);
  }
}
bool lifetime_opaque_runtime(void) {
  @autoreleasepool {
    OpaqueRuntime runtime = { .references = { 0, 1, 2 } };
    ScrJSCRuntimeOps ops = {
      .retain = opaque_retain, .release = opaque_release, .collect = opaque_collect,
    };
    Fixture f = { .context = JSGlobalContextCreate(NULL) };
    f.state = scr_jsc_create_with_runtime(f.context, &ops, &runtime); runtime.state = f.state;
    JSClassDefinition definition = kJSClassDefinitionEmpty; definition.finalize = scr_jsc_finalize;
    f.cls = JSClassCreate(&definition);
    opaque_owned(f, &runtime); collect(f);
    bool alive = runtime.references[1] == 1 && runtime.references[2] == 2 &&
      scr_jsc_native_count(f.state) == 1 && scr_jsc_foreign_count(f.state) == 1;
    evaluate(f, "root=null"); collect(f);
    bool released = runtime.references[1] == 0 && runtime.references[2] == 0 &&
      scr_jsc_native_count(f.state) == 0 && scr_jsc_foreign_count(f.state) == 0;
    scr_jsc_dispose(f.state); JSGlobalContextRelease(f.context); JSClassRelease(f.cls);
    return alive && released && runtime.releases == 4 &&
      runtime.full_collections > 0 && runtime.scheduled_collections > 0;
  }
}

bool lifetime_native_root(void) {
  @autoreleasepool {
    Fixture f = fixture(); scr_jsc_enter(f.state);
    ScrDyn *callback = foreign(f, evaluate(f, "(()=>42)"));
    Foreign *item = callback->v.handle.ptr; scr_jsc_leave(f.state); collect(f);
    JSValueRef value = scr_jsc_foreign_value(f.state, item);
    bool alive = value && JSValueToNumber(f.context,
        JSObjectCallAsFunction(f.context, (JSObjectRef)value, NULL, 0, NULL, NULL), NULL) == 42;
    scr_jsc_enter(f.state); scr_dyn_release(callback); scr_jsc_leave(f.state); collect(f);
    bool pass = alive && destroyed == 1 && scr_jsc_foreign_count(f.state) == 0; finish(f); return pass;
  }
}

__attribute__((noinline)) static void create_owned(Fixture f, bool cycle, bool alias) {
  @autoreleasepool {
    scr_jsc_enter(f.state);
    ScrDyn *native = scr_dyn_new_obj(); JSValueRef value = evaluate(f, "({marker:42})");
    scr_dyn_obj_set(native, "foreign", 7, foreign(f, value)); JSObjectRef js = wrapper(f, native);
    if (cycle) {
      property(f, (JSObjectRef)value, "native", js);
      property(f, JSContextGetGlobalObject(f.context), "cycleEndpoint", value);
    }
    else property(f, JSContextGetGlobalObject(f.context), "root", js);
    if (alias) property(f, JSContextGetGlobalObject(f.context), "alias", wrapper(f, native));
    scr_dyn_release(native); scr_jsc_leave(f.state);
  }
}

bool lifetime_js_owner(void) {
  @autoreleasepool {
    Fixture f = fixture(); create_owned(f, false, false); collect(f);
    bool alive = destroyed == 0 && scr_jsc_foreign_count(f.state) == 1 && scr_jsc_native_count(f.state) == 1;
    evaluate(f, "root=null"); collect(f);
    bool pass = alive && destroyed == 1 && scr_jsc_native_count(f.state) == 0; finish(f); return pass;
  }
}

bool lifetime_native_cycle(void) {
  @autoreleasepool {
    Fixture f = fixture(); scr_jsc_enter(f.state); ScrDyn *native = scr_dyn_new_obj();
    scr_dyn_obj_set(native, "foreign", 7, foreign(f, evaluate(f, "({})")));
    scr_dyn_obj_set(native, "self", 4, scr_dyn_retain(native));
    scr_dyn_release(native); scr_collect_cycles(); scr_jsc_leave(f.state); collect(f);
    bool pass = destroyed == 1 && scr_jsc_foreign_count(f.state) == 0; finish(f); return pass;
  }
}

__attribute__((noinline)) static bool replace_owned(Fixture f) {
  @autoreleasepool {
    scr_jsc_enter(f.state);
    JSValueRef js = evaluate(f, "root"); ScrDyn *native = scr_jsc_find_box(f.state, js);
    bool identity = scr_jsc_find_native(f.state, native) == js;
    scr_dyn_obj_set(native, "foreign", 7, foreign(f, evaluate(f, "({marker:99})")));
    scr_jsc_leave(f.state); return identity;
  }
}

bool lifetime_replace_edge(void) {
  @autoreleasepool {
    Fixture f = fixture(); create_owned(f, false, false); collect(f);
    bool identity = replace_owned(f); collect(f);
    bool replaced = destroyed == 1 && scr_jsc_foreign_count(f.state) == 1;
    evaluate(f, "root=null"); collect(f);
    bool pass = identity && replaced && destroyed == 2 && scr_jsc_native_count(f.state) == 0;
    finish(f); return pass;
  }
}

bool lifetime_aliases(void) {
  @autoreleasepool {
    Fixture f = fixture(); create_owned(f, false, true); evaluate(f, "root=null"); collect(f);
    bool alive = destroyed == 0 && scr_jsc_native_count(f.state) == 1;
    evaluate(f, "alias=null"); collect(f);
    bool pass = alive && destroyed == 1 && scr_jsc_native_count(f.state) == 0; finish(f); return pass;
  }
}

__attribute__((noinline)) static bool surviving_wrapper_identity(Fixture f) {
  @autoreleasepool {
    JSObjectRef surviving = (JSObjectRef)evaluate(f, "root");
    ScrDyn *native = scr_jsc_native_box(surviving);
    return native && scr_jsc_find_box(f.state, surviving) == native &&
      scr_jsc_find_native(f.state, native) == surviving;
  }
}
bool lifetime_older_alias(void) {
  @autoreleasepool {
    Fixture f = fixture(); create_owned(f, false, true);
    evaluate(f, "alias=null"); collect(f);
    bool alive = destroyed == 0 && scr_jsc_native_count(f.state) == 1 && surviving_wrapper_identity(f);
    evaluate(f, "root=null"); collect(f);
    bool released = destroyed == 1 && scr_jsc_native_count(f.state) == 0;
    finish(f); return alive && released;
  }
}

__attribute__((noinline)) static ScrDyn *native_alias(Fixture f) {
  return scr_dyn_retain(scr_jsc_find_box(f.state, evaluate(f, "root")));
}

bool lifetime_native_turn_root(void) {
  @autoreleasepool {
    Fixture f = fixture(); create_owned(f, false, false); collect(f);
    scr_jsc_enter(f.state); ScrDyn *native = native_alias(f);
    evaluate(f, "root=null"); JSSynchronousGarbageCollectForDebugging(f.context);
    ScrDyn *child = scr_dyn_obj_read(native, "foreign", 7);
    Foreign *reference = child->v.handle.ptr;
    bool alive = scr_jsc_foreign_value(f.state, reference) != NULL && destroyed == 0;
    scr_dyn_release(child); scr_dyn_release(native); scr_jsc_leave(f.state); collect(f);
    bool pass = alive && destroyed == 1 && scr_jsc_foreign_count(f.state) == 0;
    finish(f); return pass;
  }
}

bool lifetime_churn(void) {
  @autoreleasepool {
    Fixture f = fixture(); bool bounded = true;
    for (int i = 0; i < 100; i++) {
      create_owned(f, true, false); collect(f);
      bounded &= destroyed == (size_t)i && scr_jsc_native_count(f.state) == 1 && scr_jsc_foreign_count(f.state) == 1;
      evaluate(f, "cycleEndpoint.native=null;cycleEndpoint=null"); collect(f);
      bounded &= destroyed == (size_t)i + 1 && scr_jsc_native_count(f.state) == 0 && scr_jsc_foreign_count(f.state) == 0;
    }
    bool pass = bounded && destroyed == 100; finish(f); return pass;
  }
}

static void *finalize_thread(void *object) { scr_jsc_finalize(object); return NULL; }

bool lifetime_deferred_finalizer(void) {
  @autoreleasepool {
    Fixture f = fixture(); scr_jsc_enter(f.state); ScrDyn *native = scr_dyn_new_obj();
    scr_dyn_obj_set(native, "foreign", 7, foreign(f, evaluate(f, "({})")));
    JSObjectRef js = wrapper(f, native); JSValueProtect(f.context, js);
    scr_dyn_release(native); scr_jsc_leave(f.state);
    pthread_t thread; pthread_create(&thread, NULL, finalize_thread, js); pthread_join(thread, NULL);
    /* Inject a GC-thread notification, disarming the real wrapper afterward. */
    JSObjectSetPrivate(js, NULL); JSValueUnprotect(f.context, js); bool deferred = destroyed == 0;
    scr_jsc_sync(f.state);
    bool pass = deferred && destroyed == 1 && scr_jsc_native_count(f.state) == 0; finish(f); return pass;
  }
}

bool lifetime_dispose_with_js_owner(void) {
  @autoreleasepool {
    Fixture f = fixture(); create_owned(f, false, false); collect(f);
    bool alive = destroyed == 0;
    scr_jsc_dispose(f.state);
    /* The JS wrapper can outlive the adapter. Its later finalizer must not
     * touch the disposed runtime or the freed identity caches. */
    evaluate(f, "root=null");
    JSSynchronousGarbageCollectForDebugging(f.context);
    JSGlobalContextRelease(f.context); JSClassRelease(f.cls);
    return alive && destroyed == 1;
  }
}

__attribute__((noinline)) static JSManagedValue *temporary_string(Fixture f) {
  @autoreleasepool {
    JSContext *context = [JSContext contextWithJSGlobalContextRef:f.context];
    JSValueRef value = evaluate(f, "'temporary-'+Math.random()+'x'.repeat(1000)");
    scr_jsc_keep(f.state, value);
    return [JSManagedValue managedValueWithValue:[JSValue valueWithJSValueRef:value inContext:context]];
  }
}

bool lifetime_temporary_string(void) {
  @autoreleasepool {
    Fixture f = fixture(); scr_jsc_enter(f.state);
    JSManagedValue *weak = temporary_string(f);
    JSSynchronousGarbageCollectForDebugging(f.context);
    bool alive;
    @autoreleasepool { alive = weak.value != nil; }
    scr_jsc_leave(f.state); collect(f);
    bool pass = alive && weak.value == nil; finish(f); return pass;
  }
}

__attribute__((noinline)) static ScrDyn *temporary_facade(Fixture f) {
  @autoreleasepool {
    ScrDyn *native = scr_dyn_new_obj(); JSObjectRef js = wrapper(f, native);
    property(f, JSContextGetGlobalObject(f.context), "raw", js);
    JSValueRef facade = evaluate(f, "new Proxy(raw,{})");
    scr_jsc_set_facade(f.state, js, facade); evaluate(f, "raw=null");
    return native;
  }
}

__attribute__((noinline)) static bool facade_survives(Fixture f) {
  @autoreleasepool {
    scr_jsc_enter(f.state); ScrDyn *native = temporary_facade(f);
    JSSynchronousGarbageCollectForDebugging(f.context);
    JSValueRef found = scr_jsc_find_native(f.state, native);
    bool alive = found && scr_jsc_find_box(f.state, found) == native;
    scr_dyn_release(native); scr_jsc_leave(f.state); return alive;
  }
}

bool lifetime_temporary_facade(void) {
  @autoreleasepool {
    Fixture f = fixture(); bool alive = facade_survives(f); collect(f);
    bool pass = alive && scr_jsc_native_count(f.state) == 0; finish(f); return pass;
  }
}

__attribute__((noinline)) static void create_empty(Fixture f) {
  @autoreleasepool {
    scr_jsc_enter(f.state); ScrDyn *native = scr_dyn_new_obj();
    property(f, JSContextGetGlobalObject(f.context), "root", wrapper(f, native));
    scr_dyn_release(native); scr_jsc_leave(f.state);
  }
}

bool lifetime_first_foreign_edge(void) {
  @autoreleasepool {
    Fixture f = fixture(); create_empty(f); collect(f);
    bool identity = replace_owned(f); collect(f);
    bool alive = destroyed == 0 && scr_jsc_foreign_count(f.state) == 1;
    evaluate(f, "root=null"); collect(f);
    bool pass = identity && alive && destroyed == 1; finish(f); return pass;
  }
}

__attribute__((noinline)) static void create_duplicate_chain(Fixture f) {
  @autoreleasepool {
    scr_jsc_enter(f.state);
    ScrDyn *a = scr_dyn_new_obj(), *b = scr_dyn_new_obj();
    JSValueRef value = evaluate(f, "({marker:42})");
    scr_dyn_obj_set(b, "foreign", 7, foreign(f, value));
    scr_dyn_obj_set(b, "self", 4, scr_dyn_retain(b));
    scr_dyn_obj_set(a, "first", 5, scr_dyn_retain(b));
    scr_dyn_obj_set(a, "second", 6, b);
    JSObjectRef js = wrapper(f, a);
    property(f, (JSObjectRef)value, "native", js);
    property(f, JSContextGetGlobalObject(f.context), "root", js);
    scr_dyn_release(a); scr_jsc_leave(f.state);
  }
}

__attribute__((noinline)) static void create_two_anchor_branch(Fixture f) {
  @autoreleasepool {
    scr_jsc_enter(f.state);
    ScrDyn *a = scr_dyn_new_obj(), *b = scr_dyn_new_obj(), *c = scr_dyn_new_obj();
    scr_dyn_obj_set(b, "foreign", 7, foreign(f, evaluate(f, "({marker:42})")));
    scr_dyn_obj_set(a, "child", 5, scr_dyn_retain(b));
    scr_dyn_obj_set(c, "child", 5, b);
    property(f, JSContextGetGlobalObject(f.context), "root", wrapper(f, a));
    property(f, JSContextGetGlobalObject(f.context), "alias", wrapper(f, c));
    scr_dyn_release(a); scr_dyn_release(c); scr_jsc_leave(f.state);
  }
}

bool lifetime_contraction_two_anchors(void) {
  @autoreleasepool {
    Fixture f = fixture(); create_two_anchor_branch(f); collect(f);
    bool alive = destroyed == 0 && scr_jsc_native_count(f.state) == 2;
    evaluate(f, "root=null"); collect(f);
    alive &= destroyed == 0 && scr_jsc_foreign_count(f.state) == 1 && scr_jsc_native_count(f.state) == 1;
    evaluate(f, "alias=null"); collect(f);
    bool released = destroyed == 1 && scr_jsc_foreign_count(f.state) == 0 && scr_jsc_native_count(f.state) == 0;
    finish(f); return alive && released;
  }
}

__attribute__((noinline)) static void create_foreign_outgoing_cycle(Fixture f, bool anchored) {
  @autoreleasepool {
    scr_jsc_enter(f.state);
    ScrDyn *a = scr_dyn_new_obj(), *b = scr_dyn_new_obj(), *c = scr_dyn_new_obj();
    scr_dyn_obj_set(c, "foreign", 7, foreign(f, evaluate(f, "({marker:99})")));
    ScrDyn *first = foreign(f, evaluate(f, "({marker:42})"));
    foreign_set_child(first->v.handle.ptr, c);
    scr_dyn_obj_set(b, "foreign", 7, first);
    scr_dyn_obj_set(b, "peer", 4, scr_dyn_retain(a));
    scr_dyn_obj_set(a, "peer", 4, b);
    if (anchored) property(f, JSContextGetGlobalObject(f.context), "root", wrapper(f, a));
    scr_dyn_release(a);
    /* Explicit sync inside the turn exercises an anchorless native cycle
     * before the runtime's scheduled native collection can reclaim it. */
    scr_jsc_sync(f.state); scr_jsc_leave(f.state);
  }
}

bool lifetime_contraction_foreign_outgoing_cycle(void) {
  bool pass = true;
  for (int anchored = 0; anchored < 2; anchored++) {
    @autoreleasepool {
      Fixture f = fixture(); create_foreign_outgoing_cycle(f, anchored); collect(f);
      if (anchored) {
        pass &= destroyed == 0 && scr_jsc_foreign_count(f.state) == 2 && scr_jsc_native_count(f.state) == 1;
        evaluate(f, "root=null"); collect(f);
      }
      pass &= destroyed == 2 && scr_jsc_foreign_count(f.state) == 0 && scr_jsc_native_count(f.state) == 0;
      finish(f);
    }
  }
  return pass;
}

__attribute__((noinline)) static void remove_duplicate_edge(Fixture f, bool first) {
  scr_jsc_enter(f.state);
  ScrDyn *a = scr_jsc_find_box(f.state, evaluate(f, "root"));
  scr_dyn_obj_set(a, first ? "first" : "second", first ? 5 : 6, scr_dyn_new_null());
  scr_jsc_leave(f.state);
}

bool lifetime_persistent_duplicate_removal(void) {
  @autoreleasepool {
    Fixture f = fixture(); create_duplicate_chain(f); collect(f);
    bool alive = destroyed == 0;
    remove_duplicate_edge(f, true); collect(f);
    alive &= destroyed == 0 && scr_jsc_foreign_count(f.state) == 1;
    remove_duplicate_edge(f, false); collect(f);
    bool released = destroyed == 1 && scr_jsc_foreign_count(f.state) == 0 && scr_jsc_native_count(f.state) == 1;
    evaluate(f, "root=null"); collect(f);
    released &= scr_jsc_native_count(f.state) == 0;
    finish(f); return alive && released;
  }
}

__attribute__((noinline)) static void expand_owned(Fixture f) {
  @autoreleasepool {
    scr_jsc_enter(f.state);
    ScrDyn *native = scr_jsc_find_box(f.state, evaluate(f, "root"));
    for (int i = 0; i < 64; i++) {
      char name[32], source[32]; int length = snprintf(name, sizeof name, "leaf-%d", i);
      snprintf(source, sizeof source, "({marker:%d})", i);
      scr_dyn_obj_set(native, name, (size_t)length, foreign(f, evaluate(f, source)));
    }
    scr_jsc_leave(f.state);
  }
}

__attribute__((noinline)) static bool expanded_values_and_erase_even(Fixture f) {
  @autoreleasepool {
    scr_jsc_enter(f.state); bool alive = true;
    ScrDyn *native = scr_jsc_find_box(f.state, evaluate(f, "root"));
    JSStringRef marker = JSStringCreateWithUTF8CString("marker");
    for (int i = 0; i < 64; i++) {
      char name[32]; int length = snprintf(name, sizeof name, "leaf-%d", i);
      ScrDyn *child = scr_dyn_obj_read(native, name, (size_t)length);
      JSValueRef value = scr_jsc_foreign_value(f.state, child->v.handle.ptr);
      alive &= value && JSValueToNumber(f.context,
        JSObjectGetProperty(f.context, (JSObjectRef)value, marker, NULL), NULL) == i;
      scr_dyn_release(child);
      if (i % 2 == 0) scr_dyn_obj_set(native, name, (size_t)length, scr_dyn_new_null());
    }
    JSStringRelease(marker); scr_jsc_leave(f.state); return alive;
  }
}

bool lifetime_persistent_expansion(void) {
  @autoreleasepool {
    Fixture f = fixture(); create_empty(f); collect(f); expand_owned(f); collect(f);
    bool alive = destroyed == 0 && scr_jsc_foreign_count(f.state) == 64;
    alive &= expanded_values_and_erase_even(f); collect(f);
    bool removed = destroyed == 32 && scr_jsc_foreign_count(f.state) == 32;
    evaluate(f, "root=null"); collect(f);
    bool released = destroyed == 64 && scr_jsc_foreign_count(f.state) == 0 && scr_jsc_native_count(f.state) == 0;
    finish(f); return alive && removed && released;
  }
}

__attribute__((noinline)) static bool replace_queued_wrapper(Fixture f) {
  @autoreleasepool {
    scr_jsc_enter(f.state); ScrDyn *native = native_alias(f);
    JSObjectRef old = (JSObjectRef)evaluate(f, "root");
    pthread_t thread; pthread_create(&thread, NULL, finalize_thread, old); pthread_join(thread, NULL);
    JSObjectSetPrivate(old, NULL);
    bool deferred = destroyed == 0;
    property(f, JSContextGetGlobalObject(f.context), "alias", wrapper(f, native));
    evaluate(f, "root=null"); scr_dyn_release(native); scr_jsc_leave(f.state);
    JSObjectRef alias = (JSObjectRef)evaluate(f, "alias");
    ScrDyn *box = scr_jsc_native_box(alias);
    return deferred && box && scr_jsc_find_box(f.state, alias) == box &&
      scr_jsc_find_native(f.state, box) == alias;
  }
}

bool lifetime_persistent_replacement_finalizer(void) {
  @autoreleasepool {
    Fixture f = fixture(); create_owned(f, false, false); collect(f);
    bool deferred = replace_queued_wrapper(f); collect(f);
    bool alive = destroyed == 0 && scr_jsc_foreign_count(f.state) == 1 && scr_jsc_native_count(f.state) == 1;
    evaluate(f, "alias=null"); collect(f);
    bool released = destroyed == 1 && scr_jsc_foreign_count(f.state) == 0 && scr_jsc_native_count(f.state) == 0;
    finish(f); return deferred && alive && released;
  }
}

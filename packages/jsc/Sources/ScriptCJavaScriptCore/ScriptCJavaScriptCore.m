#import "ScriptCJavaScriptCore.h"
#import <Foundation/Foundation.h>
#include <assert.h>
#include <pthread.h>

/* Finalizers may run on GC threads. Only this queue is touched there;
 * native RC and JSC APIs stay on the runtime thread. */
typedef struct Slot Slot;
typedef struct {
  pthread_mutex_t lock;
  size_t references;
  bool closed;
  Slot *pending;
} Finalizers;
struct Slot { Finalizers *queue; ScrDyn *box; Slot *next; };

@interface ScrJSCEntry : NSObject
@property (nonatomic) JSManagedValue *value;
@property (nonatomic) void *native;
@property (nonatomic) const void *identity;
@property (nonatomic) Slot *slot;
@property (nonatomic) JSValueRef key;
@property (nonatomic) JSValueRef facadeKey;
@end
@implementation ScrJSCEntry
@end

@interface ScrJSCOwners : NSObject
@property (nonatomic) JSContext *context;
@property (nonatomic) NSMutableDictionary<NSValue *, ScrJSCEntry *> *foreign;
@property (nonatomic) NSMutableDictionary<NSValue *, ScrJSCEntry *> *native;
@property (nonatomic) NSMutableDictionary<NSValue *, ScrJSCEntry *> *byJS;
@property (nonatomic) NSMutableDictionary<NSValue *, ScrJSCEntry *> *byIdentity;
@property (nonatomic) CFMutableSetRef temporaries;
@end
@implementation ScrJSCOwners
- (void)dealloc { CFRelease(_temporaries); }
@end

struct ScrJSC {
  void *graph;
  JSGlobalContextRef context;
  ScrJSCRuntimeOps operations;
  void *runtime_context;
  Finalizers *finalizers;
  pthread_t thread;
  size_t depth;
};

static NSValue *key(const void *pointer) { return [NSValue valueWithPointer:pointer]; }
static ScrJSCOwners *graph(ScrJSC *state) {
  assert(pthread_equal(pthread_self(), state->thread));
  return (__bridge ScrJSCOwners *)state->graph;
}
static void queue_release(Finalizers *queue) {
  pthread_mutex_lock(&queue->lock);
  bool dead = --queue->references == 0;
  pthread_mutex_unlock(&queue->lock);
  if (dead) { pthread_mutex_destroy(&queue->lock); free(queue); }
}
void scr_jsc_finalize(JSObjectRef wrapper) {
  Slot *slot = JSObjectGetPrivate(wrapper);
  if (!slot) return;
  Finalizers *queue = slot->queue;
  pthread_mutex_lock(&queue->lock);
  bool closed = queue->closed;
  if (!closed) { slot->next = queue->pending; queue->pending = slot; }
  pthread_mutex_unlock(&queue->lock);
  if (closed) { free(slot); queue_release(queue); }
}
static bool drain(ScrJSC *state) {
  ScrJSCOwners *g = graph(state);
  Finalizers *queue = state->finalizers;
  pthread_mutex_lock(&queue->lock);
  Slot *pending = queue->pending; queue->pending = NULL;
  pthread_mutex_unlock(&queue->lock);
  bool finalized = pending != NULL;
  while (pending) {
    Slot *slot = pending; pending = pending->next;
    ScrJSCEntry *entry = g.native[key(slot)];
    if (g.byJS[key(entry.key)] == entry) [g.byJS removeObjectForKey:key(entry.key)];
    if (entry.facadeKey && g.byJS[key(entry.facadeKey)] == entry)
      [g.byJS removeObjectForKey:key(entry.facadeKey)];
    if (g.byIdentity[key(entry.identity)] == entry) [g.byIdentity removeObjectForKey:key(entry.identity)];
    [g.native removeObjectForKey:key(slot)];
    state->operations.release(state->runtime_context, slot->box);
    free(slot); queue_release(queue);
  }
  return finalized;
}
void scr_jsc_keep(ScrJSC *state, JSValueRef value) {
  ScrJSCOwners *g = graph(state);
  if (value && !CFSetContainsValue(g.temporaries, value)) {
    JSValueProtect(state->context, value); CFSetAddValue(g.temporaries, value);
  }
}
static void unprotect(const void *value, void *context) {
  ScrJSC *state = context; JSValueUnprotect(state->context, value);
}
static JSValueRef entry_value(ScrJSC *state, ScrJSCEntry *entry) {
  @autoreleasepool {
    JSValue *value = entry.value.value;
    JSValueRef result = value.JSValueRef;
    if (state->depth) scr_jsc_keep(state, result);
    return result;
  }
}
ScrJSC *scr_jsc_create_with_runtime(JSGlobalContextRef context,
    const ScrJSCRuntimeOps *operations, void *runtime_context) {
  assert(operations && operations->retain && operations->release && operations->collect);
  @autoreleasepool {
    ScrJSC *state = calloc(1, sizeof *state);
    state->context = context; state->thread = pthread_self();
    state->operations = *operations; state->runtime_context = runtime_context;
    state->finalizers = calloc(1, sizeof *state->finalizers);
    pthread_mutex_init(&state->finalizers->lock, NULL); state->finalizers->references = 1;
    ScrJSCOwners *g = [ScrJSCOwners new];
    g.context = [JSContext contextWithJSGlobalContextRef:context];
    g.foreign = [NSMutableDictionary new]; g.native = [NSMutableDictionary new];
    g.byJS = [NSMutableDictionary new]; g.byIdentity = [NSMutableDictionary new];
    g.temporaries = CFSetCreateMutable(NULL, 0, NULL);
    state->graph = (__bridge_retained void *)g;
    return state;
  }
}
void scr_jsc_enter(ScrJSC *state) {
  graph(state);
  if (state->depth++ == 0) {
    drain(state);
  }
}
/* One root per owned boundary handle; native aliases only change native RC.
 * Applications clear strong mixed-cycle edges at their lifecycle boundary. */
void scr_jsc_attach_foreign(ScrJSC *state, void *native, JSValueRef value) {
  ScrJSCOwners *g = graph(state); assert(!g.foreign[key(native)]);
  ScrJSCEntry *entry = [ScrJSCEntry new]; entry.native = native; entry.key = value;
  JSValueProtect(state->context, value); g.foreign[key(native)] = entry;
}
void scr_jsc_detach_foreign(ScrJSC *state, void *native) {
  ScrJSCOwners *g = graph(state); ScrJSCEntry *entry = g.foreign[key(native)];
  assert(entry); JSValueUnprotect(state->context, entry.key);
  [g.foreign removeObjectForKey:key(native)];
}
JSValueRef scr_jsc_foreign_value(ScrJSC *state, void *native) {
  return graph(state).foreign[key(native)].key;
}
void scr_jsc_attach_native(ScrJSC *state, const void *identity, ScrDyn *native, JSObjectRef wrapper) {
  ScrJSCOwners *g = graph(state);
  @autoreleasepool {
    ScrJSCEntry *entry = [ScrJSCEntry new]; entry.native = native; entry.identity = identity;
    Slot *slot = calloc(1, sizeof *slot); slot->queue = state->finalizers;
    slot->box = state->operations.retain(state->runtime_context, native); entry.slot = slot; entry.key = wrapper;
    pthread_mutex_lock(&slot->queue->lock); slot->queue->references++; pthread_mutex_unlock(&slot->queue->lock);
    JSObjectSetPrivate(wrapper, slot);
    entry.value = [JSManagedValue managedValueWithValue:[JSValue valueWithJSValueRef:wrapper inContext:g.context]];
    scr_jsc_keep(state, wrapper);
    g.native[key(slot)] = entry; g.byJS[key(wrapper)] = entry; g.byIdentity[key(identity)] = entry;

  }
}
void scr_jsc_set_facade(ScrJSC *state, JSObjectRef wrapper, JSValueRef facade) {
  ScrJSCOwners *g = graph(state); ScrJSCEntry *entry = g.byJS[key(wrapper)];
  @autoreleasepool {
    entry.value = [JSManagedValue managedValueWithValue:[JSValue valueWithJSValueRef:facade inContext:g.context]];
    entry.facadeKey = facade; g.byJS[key(facade)] = entry;
    scr_jsc_keep(state, facade);
  }
}
JSValueRef scr_jsc_find_native(ScrJSC *state, const void *identity) {
  ScrJSCOwners *g = graph(state); drain(state);
  ScrJSCEntry *cached = g.byIdentity[key(identity)];
  JSValueRef cachedValue = cached ? entry_value(state, cached) : NULL;
  if (cachedValue) return cachedValue;
  // A newer alias or its facade can die while an older wrapper remains live.
  for (ScrJSCEntry *entry in g.native.objectEnumerator) {
    if (entry.identity != identity) continue;
    JSValueRef value = entry_value(state, entry);
    if (!value) continue;
    g.byIdentity[key(identity)] = entry;
    return value;
  }
  return NULL;
}
ScrDyn *scr_jsc_find_box(ScrJSC *state, JSValueRef value) {
  ScrJSCOwners *g = graph(state); drain(state);
  ScrJSCEntry *entry = g.byJS[key(value)];
  // The facade can die before its raw wrapper and finalizer slot. A reused
  // JS address must not recover the old native payload through the raw cache.
  if (entry && entry.facadeKey == value && entry_value(state, entry) != value) return NULL;
  return entry ? entry.slot->box : NULL;
}
ScrDyn *scr_jsc_native_box(JSObjectRef wrapper) {
  Slot *slot = JSObjectGetPrivate(wrapper); return slot ? slot->box : NULL;
}

/* No bridge graph discovery or managed-reference publication. Native cycle
 * collection remains the original ScriptC collector on its original schedule. */
void scr_jsc_sync(ScrJSC *state) {
  ScrJSCOwners *g = graph(state); drain(state);
  if (!state->depth) {
    state->operations.collect(state->runtime_context, false);
    CFSetApplyFunction(g.temporaries, unprotect, state); CFSetRemoveAllValues(g.temporaries);
  }
}
void scr_jsc_leave(ScrJSC *state) {
  graph(state); assert(state->depth);
  if (--state->depth == 0) {
    scr_jsc_sync(state);
  }
}
size_t scr_jsc_foreign_count(ScrJSC *state) { return graph(state).foreign.count; }
size_t scr_jsc_native_count(ScrJSC *state) { drain(state); return graph(state).native.count; }
void scr_jsc_dispose(ScrJSC *state) {
  ScrJSCOwners *g = graph(state); drain(state);
  assert(state->depth == 0);
  pthread_mutex_lock(&state->finalizers->lock); state->finalizers->closed = true;
  Slot *pending = state->finalizers->pending; state->finalizers->pending = NULL;
  for (ScrJSCEntry *entry in g.native.allValues) entry.slot->box = NULL;
  pthread_mutex_unlock(&state->finalizers->lock);
  for (ScrJSCEntry *entry in g.native.allValues) {
    state->operations.release(state->runtime_context, entry.native);
  }
  [g.native removeAllObjects]; [g.byJS removeAllObjects]; [g.byIdentity removeAllObjects];
  while (pending) { Slot *next = pending->next; free(pending); queue_release(state->finalizers); pending = next; }
  state->operations.collect(state->runtime_context, true);
  CFSetApplyFunction(g.temporaries, unprotect, state); CFSetRemoveAllValues(g.temporaries);
  assert(g.foreign.count == 0 && "Native roots must be released before disposing the JSC adapter");
  CFBridgingRelease(state->graph); queue_release(state->finalizers); free(state);
}

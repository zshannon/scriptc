#include "scr_runtime.h"
#include "ScriptCJavaScriptCore.h"

static void *native_retain(void *context, void *object) { return scr_dyn_retain(object); }
static void native_release(void *context, void *object) { scr_dyn_release(object); }
static void native_collect(void *context, bool full) {
  if (full) scr_collect_cycles(); else scr_cyc_collect_scheduled();
}
ScrJSC *scr_jsc_create(JSGlobalContextRef context) {
  static const ScrJSCRuntimeOps operations = {
    .retain = native_retain, .release = native_release, .collect = native_collect,
  };
  return scr_jsc_create_with_runtime(context, &operations, NULL);
}

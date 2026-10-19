import { expect, test } from "vitest";
import { DYN, STRING, VOID, type IrExpr, type IrFunction, type IrModule } from "../../ir/ir.js";
import { emitLlvmModule } from "./emitter.js";
import { ReferenceWrites } from "./reference-writes.js";

const loc = { file: "bag-inputs.ts", start: 0, end: 1 };
const ref = (localId: string): IrExpr => ({ kind: "varRef", localId, type: DYN, loc });
const get: IrExpr = {
  kind: "libCall",
  fn: "dyn.bagGet",
  args: [ref("bag"), { kind: "strLit", value: "key", type: STRING, loc }, ref("receiver")],
  type: DYN,
  loc,
};
const read: IrFunction = {
  name: "read",
  params: ["bag", "receiver"].map((name) => ({ localId: name, name, type: DYN })),
  locals: ["bag", "receiver"].map((name) => ({ id: name, name, type: DYN, mutable: false })),
  returnType: DYN,
  body: [{ kind: "return", value: get, loc }],
  loc,
};

test("property bag reads borrow stable inputs and keep an owned result", () => {
  const mod: IrModule = {
    irVersion: 16,
    sourceFile: loc.file,
    entry: "main",
    functions: [{ name: "main", params: [], locals: [], returnType: VOID, body: [], loc }, read],
    lib: {
      profileName: "bag-inputs",
      prefix: "bag_",
      initSymbol: "bag_init",
      sinkRegisterSymbol: "bag_sink",
      collectSymbol: null,
      resultResetSymbol: null,
      threadInstances: false,
      exports: [],
      trapOverlays: [],
    },
  };
  const ir = emitLlvmModule(mod);
  const body = ir.match(/^define internal ptr @sc_bf_read\([^]*?^}/m)?.[0];
  expect(body).toBeDefined();
  expect(body).toContain("@scr_dyn_bag_get");
  expect(body).not.toMatch(/call ptr @scr_dyn_retain/);
  expect(body).toMatch(/ret ptr %/);
  // A callback can throw: the freshly owned result is still cleaned up.
  expect(body).toContain("@scr_dyn_release");
});

test("property bag getters invalidate heap borrows, including projected arguments", () => {
  const writes = new ReferenceWrites(new Map([[read.name, read]]), [], () => false, new Set());
  writes.enter(read);
  expect(writes.conflicts(["r:child"], writes.expr(get))).toBe(true);
  expect(writes.conflicts(["bx"], writes.expr(get))).toBe(true);
  expect(writes.conflicts(["g:owner"], writes.expr(get))).toBe(true);
});

test("property bag inputs retain mutable globals, captures, and projections", () => {
  const global = structuredClone(read);
  global.params = global.params.filter((p) => p.localId !== "bag");
  global.locals = global.locals.filter((p) => p.id !== "bag");
  const globalWrite: IrFunction = {
    name: "replace",
    params: [{ localId: "value", name: "value", type: DYN }],
    locals: [{ id: "value", name: "value", type: DYN, mutable: false }],
    returnType: VOID,
    body: [{ kind: "assign", localId: "bag", value: ref("value"), loc }],
    loc,
  };
  const globalMod = moduleFor(global, globalWrite);
  globalMod.globals = [{ id: "bag", name: "bag", type: DYN, mutable: true }];
  expect(ownedReadsBeforeGet(globalMod)).toBeGreaterThan(0);

  const captured = structuredClone(read);
  captured.params = captured.params.filter((p) => p.localId !== "bag");
  captured.captures = [{ localId: "bag", name: "bag", type: DYN }];
  captured.locals = [
    { id: "bag", name: "bag", type: DYN, mutable: true, boxed: true },
    { id: "receiver", name: "receiver", type: DYN, mutable: false },
    { id: "result", name: "result", type: DYN, mutable: false },
  ];
  captured.body = [
    { kind: "varDecl", localId: "result", init: get, loc },
    { kind: "assign", localId: "bag", value: ref("receiver"), loc },
    { kind: "return", value: ref("result"), loc },
  ];
  expect(ownedReadsBeforeGet(moduleFor(captured))).toBeGreaterThan(0);

  const ownerType = { kind: "record", shapeId: "Owner" } as const;
  const owner: IrExpr = { kind: "varRef", localId: "owner", type: ownerType, loc };
  const field: IrExpr = {
    kind: "recordGet",
    obj: owner,
    shapeId: "Owner",
    field: "child",
    type: DYN,
    loc,
  };
  const projected = structuredClone(read);
  projected.params[0] = { localId: "owner", name: "owner", type: ownerType };
  projected.locals[0] = { id: "owner", name: "owner", type: ownerType, mutable: false };
  projected.body = [
    { kind: "return", value: { ...get, args: [field, get.args[1]!, ref("receiver")] }, loc },
  ];
  const fieldWrite: IrFunction = {
    name: "replaceField",
    params: projected.params,
    locals: projected.locals,
    returnType: VOID,
    body: [
      {
        kind: "recordSet",
        obj: owner,
        shapeId: "Owner",
        field: "child",
        value: ref("receiver"),
        loc,
      },
    ],
    loc,
  };
  const projectedMod = moduleFor(projected, fieldWrite);
  projectedMod.records = [{ id: "Owner", fields: [{ name: "child", type: DYN }] }];
  expect(ownedReadsBeforeGet(projectedMod)).toBeGreaterThan(0);
});

function moduleFor(...functions: IrFunction[]): IrModule {
  return {
    irVersion: 16,
    sourceFile: loc.file,
    entry: "main",
    functions: [
      { name: "main", params: [], locals: [], returnType: VOID, body: [], loc },
      ...functions,
    ],
    lib: {
      profileName: "bag-inputs",
      prefix: "bag_",
      initSymbol: "bag_init",
      sinkRegisterSymbol: "bag_sink",
      collectSymbol: null,
      resultResetSymbol: null,
      threadInstances: false,
      exports: [],
      trapOverlays: [],
    },
  };
}

function ownedReadsBeforeGet(mod: IrModule): number {
  const ir = emitLlvmModule(mod);
  const body = ir.match(/^define internal ptr @sc_(?:bf|f)_read\([^]*?^}/m)?.[0];
  expect(body).toBeDefined();
  const get = body!.indexOf("@scr_dyn_bag_get");
  expect(get).toBeGreaterThan(0);
  return body!.slice(0, get).match(/call ptr @scr_(?:dyn_retain_v|box_get_ref)/g)?.length ?? 0;
}

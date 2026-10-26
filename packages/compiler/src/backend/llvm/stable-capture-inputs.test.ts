import { expect, test } from "vitest";
import { DYN, funcOf, VOID, type IrExpr, type IrFunction, type IrModule } from "../../ir/ir.js";
import { emitLlvmModule } from "./emitter.js";

const loc = { file: "stable-capture-inputs.ts", start: 0, end: 1 };
const targetType = funcOf([], DYN);
const readerType = funcOf([], targetType);
const ref = (localId: string, type = targetType): IrExpr => ({
  kind: "varRef",
  localId,
  type,
  loc,
});

test("ordinary native compilation keeps the original retained capture copy", () => {
  const mod = captureModule();
  expect(readerBody(emitLlvmModule(mod))).toContain("@scr_box_get_ref");
});

test("debug compilation keeps checked capture storage", () => {
  const mod = captureModule();
  expect(readerBody(emitLlvmModule(mod, { debugSources: new Map([[loc.file, " "]]) }))).toContain(
    "@scr_box_get_ref",
  );
});

test("a rebinding in any sharing closure prevents a borrowed capture copy", () => {
  const mod = captureModule();
  const outer = mod.functions.find((fn) => fn.name === "outer")!;
  outer.body.splice(2, 0, {
    kind: "exprStmt",
    expr: {
      kind: "closure",
      fnName: "writer",
      captures: ["f"],
      type: funcOf([targetType], VOID),
      loc,
    },
    loc,
  });
  mod.functions.push({
    name: "writer",
    params: [{ localId: "next", name: "next", type: targetType }],
    captures: [{ localId: "f", name: "f", type: targetType }],
    locals: [
      { id: "f", name: "f", type: targetType, mutable: true, boxed: true },
      { id: "next", name: "next", type: targetType, mutable: false },
    ],
    returnType: VOID,
    body: [{ kind: "assign", localId: "f", value: ref("next"), loc }],
    loc,
  });
  expect(readerBody(emitLlvmModule(mod))).toContain("@scr_box_get_ref");
});

test("TDZ capture reads keep checked owned loading", () => {
  const mod = captureModule();
  for (const fn of mod.functions)
    for (const local of fn.locals) if (local.id === "f") local.tdz = true;
  const outer = mod.functions.find((fn) => fn.name === "outer")!;
  const assignment = outer.body[1]!;
  if (assignment.kind !== "assign") throw new Error("fixture assignment missing");
  assignment.initializes = true;
  expect(readerBody(emitLlvmModule(mod))).toContain("@scr_box_get_ref");
});

function readerBody(ir: string): string {
  const body = ir.match(/^define internal ptr @sc_f_reader\([^]*?^}/m)?.[0];
  expect(body).toBeDefined();
  return body!;
}

function captureModule(): IrModule {
  const functions: IrFunction[] = [
    { name: "main", params: [], locals: [], returnType: VOID, body: [], loc },
    {
      name: "outer",
      params: [{ localId: "value", name: "value", type: DYN }],
      locals: [
        { id: "value", name: "value", type: DYN, mutable: false, boxed: true },
        { id: "f", name: "f", type: targetType, mutable: true, boxed: true },
      ],
      returnType: readerType,
      body: [
        { kind: "varDecl", localId: "f", init: null, loc },
        {
          kind: "assign",
          localId: "f",
          value: { kind: "closure", fnName: "target", captures: ["value"], type: targetType, loc },
          loc,
        },
        {
          kind: "return",
          value: { kind: "closure", fnName: "reader", captures: ["f"], type: readerType, loc },
          loc,
        },
      ],
      loc,
    },
    {
      name: "target",
      params: [],
      captures: [{ localId: "value", name: "value", type: DYN }],
      locals: [{ id: "value", name: "value", type: DYN, mutable: false, boxed: true }],
      returnType: DYN,
      body: [{ kind: "return", value: ref("value", DYN), loc }],
      loc,
    },
    {
      name: "reader",
      params: [],
      captures: [{ localId: "f", name: "f", type: targetType }],
      locals: [{ id: "f", name: "f", type: targetType, mutable: true, boxed: true }],
      returnType: targetType,
      body: [{ kind: "return", value: ref("f"), loc }],
      loc,
    },
  ];
  return {
    irVersion: 17,
    sourceFile: loc.file,
    entry: "main",
    functions,
    lib: {
      profileName: "stable-capture-inputs",
      prefix: "capture_",
      initSymbol: "capture_init",
      sinkRegisterSymbol: "capture_sink",
      collectSymbol: null,
      resultResetSymbol: null,
      threadInstances: false,
      exports: [],
      trapOverlays: [],
    },
  };
}

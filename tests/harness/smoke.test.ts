import { expect, test } from "vitest";
import { VERSION } from "@zshannon/scriptc-compiler";

test("workspace wiring", () => {
  expect(VERSION).toBe("0.0.1");
});

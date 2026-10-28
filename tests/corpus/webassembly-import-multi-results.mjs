// A two-i32 host import forwarded by an exported Wasm function.
const bytes = Buffer.from("AGFzbQEAAAABBgFgAAJ/fwIHAQFlAWYAAAMCAQAHBQEBcAABCgYBBAAQAAs=", "base64");
const module = new WebAssembly.Module(bytes);

function attempt(label, callback) {
  const instance = new WebAssembly.Instance(module, { e: { f: callback } });
  try {
    console.log(label, JSON.stringify(instance.exports["p"]()));
  } catch (error) {
    console.log(label, error.name);
  }
}

attempt("array", () => [3, 4]);
attempt("short", () => [3]);
attempt("long", () => [3, 4, 5]);
attempt("set", () => new Set([3, 4]));
attempt("array-like", () => ({ 0: 3, 1: 4, length: 2 }));

const overridden = JSON.parse("[1, 2]");
overridden[Symbol.iterator] = () => new Set([7, 8]).values();
attempt("overridden array iterator", () => overridden);

const events = [];
const iterable = {
  [Symbol.iterator]() {
    events.push("iterator");
    let index = 0;
    return {
      next() {
        events.push(`next ${index}`);
        return index < 2
          ? { value: { valueOf: () => (events.push("convert"), index + 10) }, done: ++index > 2 }
          : { done: true };
      },
    };
  },
};
attempt("custom", () => iterable);
console.log(events.join(","));

attempt("iterator throws", () => ({
  [Symbol.iterator]() {
    return { next() { throw new RangeError("next failed"); } };
  },
}));

// An iterable whose iteration runs code; constructing a Map from it at module
// scope is not inert even though the binding is a constant.
export const randomEntries = {
  *[Symbol.iterator]() {
    yield ["a", Math.random()];
  },
};

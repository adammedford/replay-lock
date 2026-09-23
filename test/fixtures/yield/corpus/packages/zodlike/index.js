class Schema {
  constructor(kind, shape) { this.kind = kind; this.shape = shape; }
}
function createErrorMap() { return { invalid: "Invalid input" }; }
const defaultErrorMap = createErrorMap();
export const NEVER = Object.freeze({ status: "aborted" });
export const z = {
  object: (shape) => new Schema("object", shape),
  string: () => new Schema("string"),
  errorMap: () => defaultErrorMap,
};

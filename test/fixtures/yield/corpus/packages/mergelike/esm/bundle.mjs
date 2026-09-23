const isAny = () => true;
const isNumber = value => typeof value === 'number';
// Bundlers emit namespace objects this way (tailwind-merge 3).
const validators = /*#__PURE__*/Object.defineProperty({
  __proto__: null,
  isAny,
  isNumber
}, Symbol.toStringTag, { value: 'Module' });
const config = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  validators
}, Symbol.toStringTag, { value: 'Module' }));
// Libraries snapshot built-in shapes (react-router 7).
var objectProtoNames = Object.getOwnPropertyNames(Object.prototype).sort().join("\0");
const isPlain = value => Object.getOwnPropertyNames(Object.getPrototypeOf(value)).sort().join("\0") === objectProtoNames;
const createMerge = options => classes => classes.split(' ').filter(options.keep).join(' ');
const twMerge = /*#__PURE__*/createMerge({ keep: Boolean });
export { config, isPlain, twMerge, validators };

const __proto__ = { set value(value: number) { console.log(value); } };
const box = Object.assign({}, { __proto__ }, { value: 1 });

export function affectedByPrototypeSource(value: number) { return value + 1; }

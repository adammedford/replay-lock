const borrowedPrototype = { set value(value: number) { console.log(value); } };
const box = Object.assign({ __proto__: borrowedPrototype }, { value: 1 });

export function affectedByPrototypeSetter(value: number) { return value + 1; }

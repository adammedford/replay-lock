const box = Object.assign(Object.defineProperty({}, "value", { set: console.log }), { value: 1 });

export function affectedByDefinedSetter(value: number) { return value + 1; }

function increment(box: { value: number }, step: number) {
  box.value += step;
  return box.value;
}
export function incrementOwned(value: number) {
  const box = { value: 2 };
  return increment(box, value);
}

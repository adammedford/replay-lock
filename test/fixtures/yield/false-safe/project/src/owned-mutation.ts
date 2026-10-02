function increment(box: { value: number }) { box.value++; return box.value; }
function nestedIncrement(box: { nested: { value: number } }) { box.nested.value++; return box.nested.value; }
function storeNested(box: { nested: { value: number } }, borrowed: { value: number }) { box.nested = borrowed; }
function installAndIncrement(box: { nested: { value: number } }, borrowed: { value: number }) {
  box.nested = borrowed;
  box.nested.value++;
  return box.nested.value;
}
function incrementWithCallback(first: { value: number }, second: { value: number }) {
  first.value++;
  [1].forEach(() => { second.value++; });
  return first.value;
}
export function mutatesBorrowed(box: { value: number }) { return increment(box); }
export function mutatesNestedBorrowed(box: { value: number }) { return nestedIncrement({ nested: box }); }
export function mutatesBorrowedThroughAlias(box: { value: number }) { const alias = box; return increment(alias); }

export function mutatesReplacedNested(borrowed: { value: number }) {
  const box = { nested: { value: 0 } };
  box.nested = borrowed;
  return nestedIncrement(box);
}

export function mutatesReplacedNestedThroughAlias(borrowed: { value: number }) {
  const box = { nested: { value: 0 } };
  const alias = box;
  alias.nested = borrowed;
  return nestedIncrement(box);
}

export function mutatesNestedAfterEscaping(borrowed: { value: number }) {
  const box = { nested: { value: 0 } };
  storeNested(box, borrowed);
  return nestedIncrement(box);
}

export function mutatesInstalledBorrowed(borrowed: { value: number }) {
  return installAndIncrement({ nested: { value: 0 } }, borrowed);
}

export function mutatesBorrowedInsideCallback(borrowed: { value: number }) {
  return incrementWithCallback({ value: 0 }, borrowed);
}

function mutateRest(...boxes: { value: number }[]) { boxes[1]!.value++; }
function mutateSecond(first: unknown, second: { value: number }) { second.value++; }
function mutateReassignedAlias(first: { value: number }, second: { value: number }) {
  let alias = first;
  alias = second;
  alias.value++;
}
function mutateReassignedParameter(first: { value: number }, second: { value: number }) {
  first = second;
  first.value++;
}
export function mutatesRestBorrowed(borrowed: { value: number }) { return mutateRest({ value: 0 }, borrowed); }
export function mutatesSpreadBorrowed(borrowed: { value: number }) { return mutateSecond(...[0, borrowed] as [number, { value: number }], { value: 0 }); }
export function mutatesReassignedAlias(borrowed: { value: number }) { return mutateReassignedAlias({ value: 0 }, borrowed); }
export function mutatesReassignedParameter(borrowed: { value: number }) { return mutateReassignedParameter({ value: 0 }, borrowed); }
function callbackInstallsBorrowed(first: { nested: { value: number } }, second: { value: number }) {
  [1].forEach(() => { first.nested = second; first.nested.value++; });
}
export function mutatesCallbackInstalledBorrowed(borrowed: { value: number }) { return callbackInstallsBorrowed({ nested: { value: 0 } }, borrowed); }
function destructuredMutation(input: { box: { value: number } }) { const { box } = input; return increment(box); }
export function mutatesDestructuredBorrowed(input: { box: { value: number } }) { return destructuredMutation(input); }
export function mutatesRestThroughWrapper(borrowed: { value: number }) { return mutatesRestBorrowed(borrowed); }
export function mutatesSpreadThroughWrapper(borrowed: { value: number }) { return mutatesSpreadBorrowed(borrowed); }
function mutateBoth(first: { value: number }, second: { value: number }) { first.value++; second.value++; }
function mixedOriginMutation(first: { value: number }, second: { box: { value: number } }) { const { box } = second; return mutateBoth(first, box); }
export function mutatesMixedOriginBorrowed(borrowed: { box: { value: number } }) { return mixedOriginMutation({ value: 0 }, borrowed); }
function installDestructured(first: { nested: { value: number } }, second: { box: { value: number } }) {
  const { box } = second;
  first.nested = box;
  first.nested.value++;
}
function callbackInstallDestructured(first: { nested: { value: number } }, second: { box: { value: number } }) {
  const { box } = second;
  [1].forEach(() => { first.nested = box; first.nested.value++; });
}
export function mutatesDestructuredInstalledBorrowed(borrowed: { box: { value: number } }) { return installDestructured({ nested: { value: 0 } }, borrowed); }
export function mutatesCallbackDestructuredInstalledBorrowed(borrowed: { box: { value: number } }) { return callbackInstallDestructured({ nested: { value: 0 } }, borrowed); }
export function mutatesMixedNestedBorrowed(borrowed: { box: { value: number } }) { const { box } = borrowed; return mixedOriginMutation({ value: 0 }, { box }); }

function defaultedAliasMutation(first: { box?: { value: number } }, second: { value: number }) {
  const { box = second } = first;
  box.value++;
}
export function mutatesDefaultedAliasBorrowed(borrowed: { value: number }) { return defaultedAliasMutation({}, borrowed); }

function ancestorDefaultMutation(first: { nested?: { box: { value: number } } }, second: { box: { value: number } }) {
  const { nested: { box } = second } = first;
  box.value++;
}
export function mutatesAncestorDefaultBorrowed(borrowed: { box: { value: number } }) { return ancestorDefaultMutation({}, borrowed); }

function nestedDefaultMutation(first: { box?: { value: number } }, second: { value: number }) {
  const { box = second } = first;
  const owned = { box };
  owned.box.value++;
}
export function mutatesNestedDefaultBorrowed(borrowed: { value: number }) { return nestedDefaultMutation({}, borrowed); }

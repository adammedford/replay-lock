export function pageRange({ page = 1, size = 20 }: { page?: number; size?: number } = {}): [number, number] {
  return [(page - 1) * size, page * size];
}

export const joinWith = (separator = ", ", ...parts: string[]): string => parts.join(separator);

export const pairSum = ([a, b]: [number, number], scale = 1): number => (a + b) * scale;

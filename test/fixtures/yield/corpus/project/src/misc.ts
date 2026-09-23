import { useMemo } from "reactlike";

export function getUserImgSrc(imageId?: string | null): string {
  return imageId ? `/resources/user-images/${imageId}` : "/img/user.png";
}

export function useLabel(value: string): string {
  return useMemo(() => value.toUpperCase(), [value]);
}

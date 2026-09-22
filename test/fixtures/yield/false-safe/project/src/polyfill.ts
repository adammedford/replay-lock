(String.prototype as unknown as { shout(this: string): string }).shout = function shout(this: string) {
  return this.toUpperCase();
};

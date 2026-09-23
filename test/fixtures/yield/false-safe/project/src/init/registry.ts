const plugins: string[] = [];

export function register(name: string): void {
  plugins.push(name);
}

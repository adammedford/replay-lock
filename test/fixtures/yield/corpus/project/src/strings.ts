export function slugify(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function initials(name: string): string {
  return name.split(" ").map((part) => part[0] ?? "").join("");
}

export function padId(id: number): string {
  return String(id).padStart(6, "0");
}

export function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

export function greeting(name: string): string {
  return `Hello, ${name}!`;
}

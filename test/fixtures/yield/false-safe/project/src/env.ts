const API = process.env.REPLAYLOCK_API_URL;
const { REPLAYLOCK_TOKEN } = process.env;

export function apiUrl(path: string): string {
  return `${API}${path}`;
}

export function token(): string {
  return `${REPLAYLOCK_TOKEN}`;
}

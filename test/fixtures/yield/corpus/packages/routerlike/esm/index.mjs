if (typeof window !== "undefined") {
  window.__routerlikeVersion = "1";
}
export function redirect(url) {
  return { status: 302, url };
}

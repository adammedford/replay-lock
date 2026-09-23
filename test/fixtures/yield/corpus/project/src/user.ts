import { redirect } from "routerlike";

export function parsePermissionString(permission: string) {
  const [action, entity, access] = permission.split(":");
  return { action, entity, access: access ? access.split(",") : null };
}

export function requireUser(userId: string | null) {
  if (!userId) throw redirect("/login");
  return userId;
}

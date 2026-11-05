import type { Permission } from "@ccm/shared";

export type PermissionRequirement = Permission | Permission[] | { any: Permission[] } | undefined;

/** A plain permission or an array means all are needed; `{ any }` means at least one. */
export function hasPermission(held: readonly Permission[] | undefined, need: PermissionRequirement): boolean {
  if (!need) return true;
  if (!held) return false;
  if (typeof need === "string") return held.includes(need);
  if (Array.isArray(need)) return need.every((p) => held.includes(p));
  return need.any.some((p) => held.includes(p));
}

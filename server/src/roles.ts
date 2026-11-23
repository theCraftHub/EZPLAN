/**
 * Plan roles, weakest to strongest: viewer (reads), commenter (reads and comments),
 * editor (changes the plan), manager (also shares it). Every check goes through these helpers.
 */
export type Role = "manager" | "editor" | "commenter" | "viewer";
export const RANK: Record<Role, number> = { viewer: 1, commenter: 2, editor: 3, manager: 4 };
export const canEdit = (role: Role | null | undefined) => role === "editor" || role === "manager";
export const canComment = (role: Role | null | undefined) => role === "commenter" || canEdit(role);
export const cantEdit = "Only people who can edit this plan can change it.";

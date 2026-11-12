import { prisma } from "../config/prisma.js";
import { hashPassword } from "../utils/password.js";

const safeSelect = { id: true, name: true, email: true, role: true, isActive: true, createdAt: true };
export class UserServiceError extends Error {
  constructor(message, status = 400) { super(message); this.name = "UserServiceError"; this.status = status; }
}

export async function listUsers(db = prisma) {
  return db.user.findMany({ select: safeSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
}

export async function createStaffUser(data, actorId, db = prisma) {
  const passwordHash = await hashPassword(data.password);
  try {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { name: data.name, email: data.email, passwordHash, role: "STAFF" }, select: safeSelect });
      await tx.auditLog.create({ data: { userId: actorId, action: "STAFF_USER_CREATED", entity: "User", entityId: String(user.id), metadata: { email: user.email, role: user.role } } });
      return user;
    });
  } catch (error) {
    if (error?.code === "P2002") throw new UserServiceError("An account with this email already exists", 409);
    throw error;
  }
}

export async function setStaffActive(id, isActive, actorId, db = prisma) {
  return db.$transaction(async (tx) => {
    const current = await tx.user.findUnique({ where: { id }, select: safeSelect });
    if (!current) throw new UserServiceError("User not found", 404);
    if (current.role !== "STAFF") throw new UserServiceError("Only staff accounts can be managed here", 409);
    if (current.id === actorId && !isActive) throw new UserServiceError("You cannot deactivate your own account", 409);
    if (current.isActive === isActive) return current;
    const user = await tx.user.update({ where: { id }, data: { isActive }, select: safeSelect });
    await tx.auditLog.create({ data: { userId: actorId, action: isActive ? "STAFF_USER_ACTIVATED" : "STAFF_USER_DEACTIVATED", entity: "User", entityId: String(id), metadata: { email: user.email } } });
    return user;
  });
}

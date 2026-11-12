import test from "node:test";
import assert from "node:assert/strict";
import { userCreateSchema, userStatusSchema } from "../src/schemas/users.js";
import { createStaffUser, listUsers, setStaffActive } from "../src/services/userService.js";

function memoryDb() {
  const state = { users: [], audits: [], id: 1 };
  const tx = {
    user: {
      findMany: async ({ select }) => state.users.map((user) => Object.fromEntries(Object.keys(select).map((key) => [key, user[key]]))),
      findUnique: async ({ where, select }) => { const user = state.users.find((row) => row.id === where.id); return user ? Object.fromEntries(Object.keys(select).map((key) => [key, user[key]])) : null; },
      create: async ({ data, select }) => {
        if (state.users.some((row) => row.email === data.email)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
        const user = { id: state.id++, ...data, isActive: true, createdAt: new Date() }; state.users.push(user);
        return Object.fromEntries(Object.keys(select).map((key) => [key, user[key]]));
      },
      update: async ({ where, data, select }) => { const user = state.users.find((row) => row.id === where.id); Object.assign(user, data); return Object.fromEntries(Object.keys(select).map((key) => [key, user[key]])); },
    },
    auditLog: { create: async ({ data }) => { state.audits.push(data); } },
  };
  return { state, ...tx, $transaction: (callback) => callback(tx) };
}

test("staff account schema normalizes email and rejects privileged roles or weak details", () => {
  assert.equal(userCreateSchema.parse({ name: " Staff User ", email: "STAFF@example.com", password: "correct horse battery" }).email, "staff@example.com");
  assert.equal(userCreateSchema.safeParse({ name: "A", email: "bad", password: "short" }).success, false);
  assert.equal(userCreateSchema.safeParse({ name: "Staff", email: "staff@example.com", password: "correct horse battery", role: "ADMIN" }).success, false);
  assert.equal(userStatusSchema.safeParse({ isActive: false }).success, true);
});

test("admin staff-management service creates safe staff records and audits activation changes", async () => {
  const db = memoryDb();
  const input = userCreateSchema.parse({ name: "Staff User", email: "staff@example.com", password: "correct horse battery" });
  const user = await createStaffUser(input, 99, db);
  assert.equal(user.role, "STAFF");
  assert.equal("passwordHash" in user, false);
  assert.equal(await (await import("../src/utils/password.js")).comparePassword(input.password, db.state.users[0].passwordHash), true);
  await assert.rejects(() => createStaffUser(input, 99, db), { status: 409 });
  assert.equal((await listUsers(db)).length, 1);
  const inactive = await setStaffActive(user.id, false, 99, db);
  assert.equal(inactive.isActive, false);
  assert.equal(db.state.audits.length, 2);
  assert.equal("passwordHash" in (await listUsers(db))[0], false);
});

test("staff-management service cannot alter admin accounts or deactivate self", async () => {
  const db = memoryDb();
  const admin = { id: 1, name: "Admin", email: "admin@example.com", role: "ADMIN", isActive: true, createdAt: new Date() };
  const staff = { id: 2, name: "Staff", email: "staff@example.com", role: "STAFF", isActive: true, createdAt: new Date() };
  db.state.users.push(admin, staff);
  await assert.rejects(() => setStaffActive(admin.id, false, 1, db), { status: 409 });
  await assert.rejects(() => setStaffActive(staff.id, false, staff.id, db), { status: 409 });
});

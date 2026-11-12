import test from "node:test";
import assert from "node:assert/strict";
import { loginSchema } from "../src/schemas/auth.js";
import { hashPassword, comparePassword } from "../src/utils/password.js";
import { authorizePermission, ROLE_PERMISSIONS } from "../src/middleware/authMiddleware.js";

test("login schema accepts valid credentials and rejects extra fields", () => {
  assert.equal(loginSchema.safeParse({ email: "person@example.com", password: "valid-password" }).success, true);
  assert.equal(loginSchema.safeParse({ email: "invalid", password: "x" }).success, false);
  assert.equal(loginSchema.safeParse({ email: "person@example.com", password: "x", role: "ADMIN" }).success, false);
});

test("password hashes are salted and verify without storing plaintext", async () => {
  const password = "sample-passphrase-123";
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, password);
  assert.notEqual(first, second);
  assert.equal(await comparePassword(password, first), true);
  assert.equal(await comparePassword("wrong-password", first), false);
});

test("role permissions limit staff writes while allowing managers and admins", () => {
  assert.equal(ROLE_PERMISSIONS.STAFF.includes("products:read"), true);
  assert.equal(ROLE_PERMISSIONS.STAFF.includes("products:write"), false);
  assert.equal(ROLE_PERMISSIONS.MANAGER.includes("products:write"), true);
  assert.equal(ROLE_PERMISSIONS.MANAGER.includes("users:manage"), false);
  assert.equal(ROLE_PERMISSIONS.ADMIN.includes("users:manage"), true);
});

test("permission middleware rejects missing roles and allows an authorized role", () => {
  const run = (user, permission) => {
    let next = false;
    let status;
    const response = { status(value) { status = value; return this; }, json() { return this; } };
    authorizePermission(permission)({ user }, response, () => { next = true; });
    return { next, status };
  };
  assert.deepEqual(run({ role: "STAFF" }, "sales:write"), { next: false, status: 403 });
  assert.deepEqual(run({ role: "MANAGER" }, "sales:write"), { next: true, status: undefined });
});

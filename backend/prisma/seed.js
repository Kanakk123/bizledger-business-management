import "../src/config/env.js";
import { z } from "zod";
import { prisma } from "../src/config/prisma.js";
import { hashPassword } from "../src/utils/password.js";

const seedConfig = z.object({
  ADMIN_EMAIL: z.email(),
  ADMIN_PASSWORD: z.string().min(12),
  ADMIN_NAME: z.string().trim().min(1).max(100).default("BizLedger Admin"),
});

async function seedAdmin() {
  const config = seedConfig.safeParse(process.env);
  if (!config.success) {
    throw new Error("Set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters in backend/.env before seeding.");
  }

  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = config.data;
  const passwordHash = await hashPassword(ADMIN_PASSWORD);
  const user = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL.toLowerCase() },
    update: {},
    create: {
      name: ADMIN_NAME,
      email: ADMIN_EMAIL.toLowerCase(),
      passwordHash,
      role: "ADMIN",
      isActive: true,
    },
    select: { id: true, email: true },
  });

  console.log(`Admin account is ready for ${user.email}. Existing account details were preserved.`);
}

try {
  await seedAdmin();
} catch (error) {
  console.error("Admin seed failed:", error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

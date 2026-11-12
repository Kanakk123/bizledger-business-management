import { z } from "zod";

export const userCreateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.email().max(150).transform((value) => value.trim().toLowerCase()),
  password: z.string().min(8).max(200),
}).strict();

export const userStatusSchema = z.object({ isActive: z.boolean() }).strict();

/**
 * Prisma client singleton.
 *
 * Env vars must be loaded BEFORE this module is imported.
 * server.js loads dotenv early via an absolute path so this is safe regardless
 * of the working directory the process was started from.
 */
import "./env.js";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client.ts";

const adapter = new PrismaMariaDb({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "bizledger_db",
  connectionLimit: 5,
});

export const prisma = new PrismaClient({ adapter });

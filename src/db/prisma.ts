import { PrismaClient } from "@prisma/client";

// Single shared client — the cron job is short-lived and single-threaded.
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

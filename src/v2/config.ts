import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  CORS_ORIGINS: z.string().default("*"),
  API_KEY: z.string().optional(),
  ADMIN_API_KEY: z.string().optional(),
});

export const config = schema.parse({
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  HOST: process.env.HOST,
  DATABASE_URL: process.env.DATABASE_URL,
  CORS_ORIGINS: process.env.CORS_ORIGINS,
  API_KEY: process.env.API_KEY,
  ADMIN_API_KEY: process.env.ADMIN_API_KEY,
});

export const corsOrigins = config.CORS_ORIGINS === "*"
  ? true
  : config.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean);

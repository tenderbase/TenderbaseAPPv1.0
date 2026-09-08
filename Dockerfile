# ---------------------------------------------------------------------------
# TenderBase — pipeline + API.
#
# Three stages: build (compiles TypeScript), deps (runtime dependencies only),
# release. The released image carries no TypeScript toolchain, which keeps it
# small and keeps RAM free for Prisma — useful on a 512 MB free instance.
#
# Build and run:
#   docker build -t tenderbase .
#   docker run --rm -p 3000:10000 --env-file .env tenderbase
#
#   # the hourly job instead of the API, from the same image:
#   docker run --rm --env-file .env \
#     tenderbase sh -c "npx prisma migrate deploy && node dist/cli/hourly.js"
# ---------------------------------------------------------------------------

FROM node:20-slim AS base

ENV NODE_ENV=production \
    TZ=UTC

WORKDIR /app

# Prisma's query engine links against OpenSSL; ca-certificates is for the
# outbound HTTPS calls to the eTenders OCDS API.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*


# ------------------------------------------------------------------ build
# Needs devDependencies (typescript) to compile, then throws them away.
FROM base AS build

COPY package.json package-lock.json tsconfig.json ./
COPY prisma ./prisma

RUN npm ci
RUN ./node_modules/.bin/prisma generate

COPY src ./src
RUN ./node_modules/.bin/tsc -p tsconfig.json


# ------------------------------------------------------------------- deps
FROM base AS deps

COPY package.json package-lock.json ./
COPY prisma ./prisma

# `npm ci` (not `npm install`) so a lockfile/package.json mismatch fails the
# build instead of silently drifting.
RUN npm ci --omit=dev && npm cache clean --force
RUN ./node_modules/.bin/prisma generate


# ---------------------------------------------------------------- release
FROM base AS release

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY --from=build /app/dist ./dist
# Kept so `node dist/cli/ingest.js` can replay the 1,845 fixtures offline,
# which makes debugging possible without hitting the upstream API.
COPY fixtures ./fixtures

# Render injects PORT; 10000 is its default and a safe fallback elsewhere.
ENV PORT=10000
EXPOSE 10000

# Migrations run at START, not at BUILD: the database may not exist yet when
# the image is built (true for Neon too — the connection strings are supplied
# at run time). `prisma migrate deploy` is idempotent and takes a Postgres
# advisory lock, so it is safe when several instances start at once.
# `exec` replaces the shell so the server receives SIGTERM directly and can
# shut down gracefully.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && exec node dist/cli/serve.js"]

# syntax=docker/dockerfile:1
#
# The production image. Multi-stage so the native toolchain that builds
# better-sqlite3 never ships to the VM.
#
# It deliberately keeps a real node_modules rather than a Next.js standalone
# bundle: the same image also runs `npm run db:migrate` and `npm run sweep`,
# and having one runtime layout for all three means the deploy script runs the
# same commands a developer runs locally.

# Pinned to the exact patch, matching .nvmrc. A floating `node:26` tag would
# make two builds of the same commit differ.
FROM node:26.8.2-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# --- dependencies (with the toolchain for better-sqlite3) --------------------
# The toolchain is still required, and the reason is not obvious: v13 DOES ship
# prebuilt binaries for linux-x64/arm64 in the npm tarball, but it declares no
# `install` script while shipping a `binding.gyp` — so npm falls back to its
# default `node-gyp rebuild` and compiles anyway. Removing python3/make/g++
# here fails the build with "find Python". Verified, not assumed.
FROM base AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# --- build ------------------------------------------------------------------
FROM deps AS builder
COPY . .
# A placeholder secret: the build never issues a session, and baking a real
# one into an image layer would leak it.
RUN AUTH_SECRET=build-placeholder-secret-at-least-32-chars npm run build

# --- production dependencies only -------------------------------------------
FROM base AS prod-deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Fail the build here rather than at runtime if the prebuilt binary is missing
# for this platform: a native module that silently fell back to a broken
# compile produces a confusing crash on the first query instead.
RUN node -e "const D=require('better-sqlite3'); new D(':memory:').exec('select 1'); console.log('better-sqlite3 ok on ' + process.version)"

# --- runtime ----------------------------------------------------------------
FROM base AS runner
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl sqlite3 \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/app/data/evg.db

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY package.json package-lock.json next.config.mjs tsconfig.json ./
COPY public ./public
COPY src ./src
COPY scripts ./scripts

# The database lives on a mounted volume, never inside the image.
RUN mkdir -p /app/data && chown -R node:node /app/data /app/.next
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:3000/api/health || exit 1

CMD ["npm", "run", "start"]

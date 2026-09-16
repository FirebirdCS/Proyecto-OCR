# Cloud Run image for the API. The client is published separately, so nothing
# here builds or serves it. No credentials are copied in: the service runs as a
# service account, and firebase-admin and Vision both pick that up on their own.
# Node 22+, not 20: pnpm 11 loads node:sqlite, which Node 20 does not have.
FROM node:22-slim AS base
# Installed straight from npm rather than through corepack: the corepack that
# ships with Node 20 fails to verify current pnpm signatures. Keep in step with
# "packageManager" in package.json.
RUN npm install --global pnpm@11.15.1
WORKDIR /app

# Manifests only, so this layer is reused until dependencies actually change.
# A frozen install checks the lockfile against the whole workspace, so the
# client's manifest has to be here even though it is never built.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/
COPY client/package.json client/
RUN pnpm install --frozen-lockfile --filter @ocr/server...

FROM deps AS build
COPY server/ server/
RUN pnpm --filter @ocr/server build

# The runtime carries production dependencies and compiled JavaScript only.
FROM base AS runtime
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/
COPY client/package.json client/
RUN pnpm install --frozen-lockfile --prod --filter @ocr/server...
COPY --from=build /app/server/dist server/dist

USER node
# Cloud Run assigns the port through PORT, which config/env.ts reads.
EXPOSE 8080
CMD ["node", "server/dist/index.js"]

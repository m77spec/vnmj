# Stage 1: Dependencies
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Builder
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# We disable telemetry to opt out of Next.js collecting usage data.
ENV NEXT_TELEMETRY_DISABLED 1

# If there is a root lockfile, better explicitly copy it if turbopack complains? 
# In a docker image, it's separated anyway.

# NEXT_PUBLIC_* values are inlined at build time, so they must be available here.
# Railway: set NEXT_PUBLIC_API_URL on the frontend service (it is passed as a build arg).
# This default is the real deployed backend, so even if no build arg is passed the
# image bakes the correct URL. Note: no "/api" suffix (backend has no global prefix).
ARG NEXT_PUBLIC_API_URL=https://backend-production-e991.up.railway.app
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN NEXT_PUBLIC_API_URL="$(echo "$NEXT_PUBLIC_API_URL" | sed 's#/api/*$##')" npm run build

# Stage 3: Runner
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# This Next version nests the standalone server under a folder named after the
# build-root folder (e.g. "app", "frontend", ...). Find the real server.js
# wherever it is and flatten it to the image root, so /app/server.js always
# exists regardless of the start command used by the platform.
RUN dir="$(dirname "$(find /app -maxdepth 2 -name server.js | head -1)")" && cp -r "$dir/." /app/
RUN chown -R nextjs:nodejs /app
COPY --from=builder --chown=nextjs:nodejs /app/.next/static /app/.next/static

USER nextjs

EXPOSE 3000

ENV PORT 3000

CMD ["node", "server.js"]

FROM oven/bun:1.3.10-alpine AS builder

WORKDIR /app

# Copy package management files first for better caching
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy the rest of the application
COPY . .

# Build the application
# Ensure environment variables needed for build (if any) are passed when building,
# but usually Vinext builds standalone bundles purely from source.
RUN bun run build:vinext

# -------------------------
# Stage 2: Runner
# -------------------------
FROM oven/bun:1.3.10-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
ENV PORT=3000
# Adding Dokploy/Railway fallback variables
ENV AUTH_TRUST_HOST="true"
ENV USE_REMOTE_DB="true"
ENV AUTH_DISABLE_SES="true"
ENV SES_ALLOW_DYNAMIC_CODE="true"

# Copy package management files (needed for `bun run start` which invokes `vinext start`)
COPY --from=builder /app/package.json .
COPY --from=builder /app/bun.lock .

# Note: We must retain node_modules because `vinext start` relies on `vinext` and its dependencies
# at runtime. In typical Next.js apps, `standalone` mode copies node_modules, but Vinext needs them.
COPY --from=builder /app/node_modules ./node_modules

# Copy build artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts

EXPOSE 3000

CMD ["bun", "run", "start"]

ARG NODE_VERSION=24.20.0
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci \
    && node -e "if (require('./node_modules/webmcp-evals/package.json').version !== '0.0.4') process.exit(1)"

ARG NODE_VERSION=24.20.0
FROM node:${NODE_VERSION}-bookworm-slim AS builder
ARG GIT_SHA=development
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV GIT_SHA=${GIT_SHA}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

ARG NODE_VERSION=24.20.0
FROM node:${NODE_VERSION}-bookworm-slim AS runner
ARG CHROME_VERSION=154.0.8025.0-1
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg fonts-liberation \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
      | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
      > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends google-chrome-unstable=${CHROME_VERSION} \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --create-home nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs scripts ./scripts
USER nextjs
EXPOSE 3000
CMD ["sh", "-c", "if [ \"$CALLSMITH_PROCESS_TYPE\" = \"worker\" ]; then exec node scripts/browser-worker.mjs; else exec node server.js; fi"]

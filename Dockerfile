# SAID — multi-stage production image
FROM node:22-bookworm-slim AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22-bookworm-slim AS server
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV NODE_ENV=production
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev
COPY server/ ./server/
COPY --from=client-build /app/client/dist ./client/dist
RUN mkdir -p /app/server/data
ENV DATABASE_PATH=/app/server/data/said.db
ENV PORT=8787
EXPOSE 8787
VOLUME ["/app/server/data"]
WORKDIR /app/server
CMD ["node", "src/index.js"]

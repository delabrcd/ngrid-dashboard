# Built on the official Playwright image so Chromium + its OS deps are present
# for the in-process scraper. Node 20 ships in this image.
FROM mcr.microsoft.com/playwright:v1.60.0-noble AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

# Test stage: source + deps, no build. `docker build --target test -t ng-test ./app`
# then `docker run --rm ng-test` runs the hand-calculated unit tests.
FROM mcr.microsoft.com/playwright:v1.60.0-noble AS test
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
CMD ["npx", "vitest", "run"]

FROM mcr.microsoft.com/playwright:v1.60.0-noble AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `npm run build` runs `prisma generate && next build`.
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.60.0-noble AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# poppler-utils provides `pdftotext`, used to parse the bill PDFs for the
# per-fuel supply/delivery breakdown (full history; the API only has ~24 months).
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh && mkdir -p /data/pdfs /data/session
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]

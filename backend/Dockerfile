FROM node:22-bookworm-slim AS dependencies
WORKDIR /app/backend
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS prisma-build
WORKDIR /app/backend
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY src ./src
# Prisma 7 evaluates DATABASE_URL while loading prisma.config.ts, even for generate.
ENV DATABASE_URL=mysql://build:build@127.0.0.1:3306/bizledger_build
RUN npm run db:generate

# This target includes the Prisma CLI and existing migrations. It is used by
# `docker compose run --rm migrate`, not by the API runtime container.
FROM prisma-build AS migrator
ENV NODE_ENV=production
USER node
CMD ["npm", "run", "db:migrate"]

FROM node:22-bookworm-slim AS production-dependencies
WORKDIR /app/backend
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app/backend
COPY --from=production-dependencies --chown=node:node /app/backend/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --from=prisma-build --chown=node:node /app/backend/src/generated/prisma ./src/generated/prisma
COPY --chown=node:node prisma/seed.js ./prisma/seed.js
EXPOSE 5000
USER node
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 CMD node -e "fetch('http://127.0.0.1:5000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]

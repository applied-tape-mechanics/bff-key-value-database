FROM node:24-slim AS base
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install

COPY . .

# Test stage: includes devDependencies for tsc and full test suite
FROM base AS test
ENV NODE_ENV=test
CMD ["npm", "test"]

# Production stage: clean production image with minimal footprint
FROM node:24-slim AS production
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

EXPOSE 8000

CMD ["node", "src/server.ts"]

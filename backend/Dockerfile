FROM node:22-alpine AS base
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --offline --no-audit --no-fund

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app ./
CMD ["npm", "start"]

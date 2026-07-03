# syntax=docker/dockerfile:1

# ---- build stage ----------------------------------------------------------
# Has devDependencies (typescript, htmx.org, etc.) so it can compile the TS
# and let scripts/copy-web-assets.js vendor htmx.min.js into dist/.
FROM node:22-alpine AS build
WORKDIR /app

# Copying just the manifests first means this npm ci layer is only
# invalidated when dependencies actually change, not on every source edit.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- runtime stage ----------------------------------------------------------
# Fresh, minimal image: only the compiled output and production deps, no
# TypeScript/eslint/vitest/htmx.org (htmx.org is a devDependency — its only
# job is to be vendored into dist/web/public/htmx.min.js at build time, which
# already happened above and is copied in below).
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

# Alpine's node image ships a non-root 'node' user — use it instead of root.
USER node

EXPOSE 3000

ENTRYPOINT ["node", "dist/cli/index.js"]
CMD ["serve", "--host", "0.0.0.0", "--port", "3000"]

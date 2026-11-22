# Imagen oficial del servidor AstroCitas (multi-arquitectura: amd64/arm64 → VPS, Raspberry Pi, NAS).
# Construir desde la raíz del monorepo:  docker build -f apps/server/Dockerfile -t astrocitas-server .
ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter "@astrocitas/server..." --filter "@astrocitas/web..."
RUN pnpm --filter @astrocitas/web build && pnpm --filter @astrocitas/server build
RUN pnpm --filter @astrocitas/server deploy --prod --legacy /out

FROM ${NODE_IMAGE}
ARG VERSION=0.0.0
ENV NODE_ENV=production \
    ASTRO_VERSION=${VERSION} \
    DATA_DIR=/data \
    WEB_DIR=/app/web \
    PORT=8080 \
    HOST=0.0.0.0
WORKDIR /app
COPY --from=build /out/node_modules /app/node_modules
COPY --from=build /out/package.json /app/package.json
COPY --from=build /src/apps/server/dist /app/dist
COPY --from=build /src/apps/web/dist /app/web
COPY --from=build /src/apps/server/public /app/public
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--no-warnings=ExperimentalWarning", "dist/server.mjs"]

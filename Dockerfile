FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY vue ./vue
COPY vite.config.js ./
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libheif-examples tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package*.json server.js ./
COPY config ./config
COPY model ./model
COPY controller ./controller
COPY middleware ./middleware
COPY routes ./routes
COPY service ./service
COPY scripts ./scripts
RUN mkdir /data /backups && chown node:node /data /backups
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]

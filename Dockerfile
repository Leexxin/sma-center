FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV SMA_CENTER_SELF_HOSTED=1 NEXT_TELEMETRY_DISABLED=1 SMA_CENTER_DATA_DIR=/tmp/sma-center-build NODE_OPTIONS=--max-old-space-size=1536
RUN ./node_modules/.bin/next build --webpack
ENV NODE_ENV=production SMA_CENTER_DATA_DIR=/data PORT=3000
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "deploy/server.mjs"]

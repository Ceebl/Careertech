# node:sqlite is built in from Node 22.5+, so there are no native modules
# to compile and no build toolchain needed in the image.
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

# Copy manifests first so `npm ci` is cached unless dependencies change.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

# Databases live on a mounted volume so they survive redeploys.
ENV DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 3000
USER node

CMD ["node", "server.js"]

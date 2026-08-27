# Deliberately a separate image from api/, not another router inside it.
#
# This app holds the only data on the box that would actually hurt to lose or
# leak, and the shared api container serves endpoints that are open to the whole
# internet. Separate image, separate process, separate volume means a bug over
# there cannot read this database or take this process down with it.
#
# node:sqlite is built into Node 22.5+, so there is nothing native to compile.
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

# The database and the session-secret file live on a mounted volume so they
# survive redeploys.
ENV DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 3001

# Never run as root. The deploy chowns the volume to this uid.
USER node

CMD ["node", "server.js"]

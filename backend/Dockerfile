FROM node:20-alpine

RUN apk add --no-cache curl

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src/ ./src/
COPY server.js ./

RUN mkdir -p /models

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:4000/health || exit 1

CMD ["node", "server.js"]

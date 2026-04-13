# Dockerfile — FL-IDS Node.js Backend
FROM node:20-alpine

# Install curl for Docker health check
RUN apk add --no-cache curl

WORKDIR /app

# Copy dependency files first (Docker layer cache — only reinstalls on package changes)
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY src/  ./src/
COPY server.js ./

# Create models directory for .pt file storage
RUN mkdir -p /models

EXPOSE 4000

# Health check — fails container startup if Node is not responding
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:4000/health || exit 1

CMD ["node", "server.js"]
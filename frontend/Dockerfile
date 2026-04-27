# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy all source code
COPY . .

# List files before build (debug)
RUN echo "=== Files before build ===" && ls -la

# Run the build
RUN npm run build

# List dist folder after build (debug)
RUN echo "=== Dist folder contents ===" && ls -la dist/ || echo "DIST FOLDER NOT FOUND!"

# Stage 2: Production
FROM nginx:alpine

# Copy built files
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config
COPY --from=builder /app/nginx.conf /etc/nginx/conf.d/default.conf

# List what was copied (debug)
RUN echo "=== Nginx HTML folder ===" && ls -la /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

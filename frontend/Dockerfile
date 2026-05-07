# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Delete stale lock file and do a clean install
# This prevents version mismatches between package.json and package-lock.json
RUN rm -f package-lock.json && npm install

# Copy all source code
COPY . .

# Run the build
RUN npm run build

# Stage 2: Production (nginx serves the built static files)
FROM nginx:alpine

# Copy built files from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY --from=builder /app/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

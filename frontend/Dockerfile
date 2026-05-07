# frontend/Dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy ONLY package.json — NOT package-lock.json
# (package-lock.json is gitignored so it won't be present)
# This guarantees npm always resolves fresh from package.json,
# preventing Docker layer cache from skipping @tensorflow/tfjs install.
COPY package.json ./

RUN npm install

COPY . .

RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine
COPY --from=builder /app/dist      /usr/share/nginx/html
COPY --from=builder /app/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

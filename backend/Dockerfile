FROM node:20-alpine

RUN apk add --no-cache curl

WORKDIR /app

COPY package*.json ./
RUN npm install --only=production
COPY src/ ./src/
COPY server.js ./

RUN mkdir -p /models

EXPOSE 4000

CMD ["node", "server.js"]

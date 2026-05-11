FROM node:20-alpine

RUN apk add --no-cache curl python3 py3-pip

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src/ ./src/
COPY server.js ./

RUN mkdir -p /models

EXPOSE 4000

CMD ["node", "server.js"]

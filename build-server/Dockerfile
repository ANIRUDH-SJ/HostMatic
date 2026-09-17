FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY api-server/package.json api-server/package.json
COPY build-server/package.json build-server/package.json
COPY s3-reverse-proxy/package.json s3-reverse-proxy/package.json
COPY frontend-nextjs/package.json frontend-nextjs/package.json
RUN npm ci --omit=dev
COPY lib ./lib
COPY build-server ./build-server
CMD ["node", "build-server/index.js"]

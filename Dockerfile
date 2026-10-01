FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
ENV HOST=0.0.0.0 PORT=3100
EXPOSE 3100
CMD ["node", "dist/server.mjs"]

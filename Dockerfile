FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY src/ ./src/
RUN addgroup -S proxy && adduser -S proxy -G proxy
USER proxy
EXPOSE 3456
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- http://localhost:3456/health || exit 1
CMD ["node", "src/index.js"]

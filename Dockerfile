FROM node:22-slim

# Install Chromium and dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libdrm2 \
    libgbm1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install
COPY relay-server/package*.json ./relay-server/
RUN cd relay-server && npm ci --omit=dev

# Copy source
COPY relay-server/ ./relay-server/
COPY mcp/ ./mcp/

# Build
RUN cd relay-server && npm run build

# Set Chrome path for Playwright CDP
ENV CHROME_PATH=/usr/bin/chromium
ENV NODE_ENV=production

# Generate config on startup if not provided
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 9333 9334

ENTRYPOINT ["/app/docker-entrypoint.sh"]

# Signal K Server - Minimal Container Image
# Uses local npm install (not global) to avoid permission issues
# Based on Node 22 Debian slim for smaller image size

FROM docker.io/library/node:22-slim AS builder

# Update npm to latest version
RUN npm install -g npm@latest

WORKDIR /build

# Copy package files and workspaces for install
COPY package*.json ./
COPY packages/ ./packages/

# Install all dependencies (including dev for workspace builds)
RUN npm install

# Copy source and build
COPY tsconfig*.json ./
COPY src/ ./src/
COPY bin/ ./bin/
COPY public/ ./public/
COPY index.js ./

# Build TypeScript
RUN npm run build

# Production stage
FROM docker.io/library/node:22-slim

# Update npm to latest version
RUN npm install -g npm@latest

# Install minimal runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    can-utils \
    avahi-daemon \
    libnss-mdns \
    libavahi-compat-libdnssd-dev \
    dbus \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/run/dbus

# Use existing node user (UID 1000) - standard in node images
# Create directories
RUN mkdir -p /home/node/signalk-server \
    && mkdir -p /home/node/.signalk \
    && chown -R node:node /home/node

WORKDIR /home/node/signalk-server

# Copy package files
COPY --chown=node:node package*.json ./
COPY --chown=node:node packages/ ./packages/

# Switch to node user for npm install
USER node

# Install production dependencies only
RUN npm install --omit=dev

# Copy built artifacts from builder
COPY --from=builder --chown=node:node /build/dist/ ./dist/
COPY --from=builder --chown=node:node /build/bin/ ./bin/
COPY --from=builder --chown=node:node /build/public/ ./public/
COPY --from=builder --chown=node:node /build/index.js ./

# Copy startup script
COPY --chown=node:node podman/startup.sh ./startup.sh
USER root
RUN chmod +x startup.sh
USER node

EXPOSE 3000

ENV IS_IN_DOCKER=true
ENV SIGNALK_NODE_CONFIG_DIR=/home/node/.signalk
ENV NODE_ENV=production

WORKDIR /home/node/.signalk

ENTRYPOINT ["/home/node/signalk-server/startup.sh"]

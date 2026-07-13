# syntax=docker/dockerfile:1
FROM node:23-alpine

WORKDIR /app

# 1. OPTIONAL: Switch to a faster global mirror if your regional routing is poor
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.edge.kernel.org/g' /etc/apk/repositories

# 2. CACHE SAVER: Install heavy OS dependencies FIRST.
# Because this is above the 'COPY' commands, this layer only reruns when the
# package list below changes - not on every code/package.json change. The
# --mount=type=cache additionally persists apk's downloaded .apk files in a
# BuildKit cache *outside* the image (so `--no-cache` is dropped here - that
# flag tells apk not to keep anything, which would defeat the mount). That
# means even when this layer *does* have to rerun (e.g. the package list
# changes, or the base image is repulled), it reinstalls from local cache
# instead of re-downloading ~188 packages from the network every time.
RUN --mount=type=cache,target=/var/cache/apk \
    apk update --cache-dir /var/cache/apk && \
    apk add --cache-dir /var/cache/apk \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# 3. Set Puppeteer environment variables
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# 4. NOW copy package files and install Node dependencies.
# If package.json changes, only this step and below are re-run. The cache
# mount similarly persists npm's package tarballs across builds.
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm install

# 5. Copy the rest of the application code
COPY . .

EXPOSE 8000

CMD ["npm", "start"]
FROM node:23-alpine

WORKDIR /app

# 1. OPTIONAL: Switch to a faster global mirror if your regional routing is poor
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.edge.kernel.org/g' /etc/apk/repositories

# 2. CACHE SAVER: Install heavy OS dependencies FIRST.
# Because this is above the 'COPY' commands, Docker will cache this step permanently 
# unless you change the exact packages listed here.
RUN apk update && apk add --no-cache \
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
# If package.json changes, only this step and below are re-run.
COPY package*.json ./
RUN npm install

# 5. Copy the rest of the application code
COPY . .

EXPOSE 8000

CMD ["npm", "start"]
FROM node:22-bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      python3-pip \
      ca-certificates \
      curl && \
    pip3 install --break-system-packages --no-cache-dir -U yt-dlp && \
    yt-dlp --version && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

ENV PORT=10000
EXPOSE 10000

CMD ["npm", "start"]

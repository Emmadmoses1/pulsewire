FROM node:22-bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      python3-pip \
      ca-certificates \
      curl \
      git && \
    pip3 install --break-system-packages --no-cache-dir -U yt-dlp bgutil-ytdlp-pot-provider && \
    git clone --single-branch --branch 2.0.0 \
      https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git \
      /opt/bgutil-ytdlp-pot-provider && \
    cd /opt/bgutil-ytdlp-pot-provider/server && \
    npm ci && \
    npx tsc && \
    yt-dlp --version && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

ENV PORT=10000
EXPOSE 10000

CMD ["sh", "-c", "node /opt/bgutil-ytdlp-pot-provider/server/build/main.js --host 127.0.0.1 --port 4416 > /tmp/bgutil.log 2>&1 & PROVIDER_PID=$!; for i in $(seq 1 30); do if curl -fsS http://127.0.0.1:4416/ping >/dev/null 2>&1; then echo 'bgutil provider is READY'; break; fi; if ! kill -0 $PROVIDER_PID 2>/dev/null; then echo 'bgutil provider EXITED'; cat /tmp/bgutil.log; exit 1; fi; sleep 1; done; if ! curl -fsS http://127.0.0.1:4416/ping >/dev/null 2>&1; then echo 'bgutil provider FAILED TO START'; cat /tmp/bgutil.log; exit 1; fi; echo '===== BGUTIL LOG ====='; cat /tmp/bgutil.log; echo '===== YT-DLP VERSION ====='; yt-dlp --version; echo '===== STARTING WAVZO MP3 SERVICE ====='; exec node server.js"]

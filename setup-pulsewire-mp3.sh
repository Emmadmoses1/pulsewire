#!/data/data/com.termux/files/usr/bin/bash
set -e

echo "=== PulseWire MP3 Conversion Setup ==="

cd "$HOME/pulsewire-static"

# Backup admin before touching anything
cp admin.html "admin.html.mp3-backup-$(date +%Y%m%d-%H%M%S)"

# Create conversion service
mkdir -p mp3-service
cd mp3-service

cat > package.json <<'EOF'
{
  "name": "pulsewire-mp3-service",
  "version": "1.0.0",
  "private": true,
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^5.1.0",
    "fluent-ffmpeg": "^2.1.3",
    "multer": "^2.0.2"
  }
}
EOF

cat > Dockerfile <<'EOF'
FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY server.js .

ENV PORT=8080
EXPOSE 8080

CMD ["npm","start"]
EOF

cat > server.js <<'EOF'
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const os = require("os");

const app = express();

app.use(cors({
  origin: true,
  methods: ["GET", "POST", "OPTIONS"]
}));

const upload = multer({
  dest: os.tmpdir(),
  limits: {
    fileSize: 500 * 1024 * 1024
  }
});

app.get("/", (req, res) => {
  res.json({
    service: "PulseWire MP3 Converter",
    status: "online"
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/convert", upload.single("media"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No media file supplied." });
  }

  const artist = String(req.body.artist || "Unknown Artist").trim();
  const title = String(req.body.title || "Untitled").trim();
  const track = String(req.body.track || "").trim();
  const year = String(req.body.year || "").trim();
  const genre = String(req.body.genre || "").trim();

  const input = req.file.path;
  const output = path.join(
    os.tmpdir(),
    `pulsewire-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`
  );

  try {
    await new Promise((resolve, reject) => {
      let command = ffmpeg(input)
        .audioCodec("libmp3lame")
        .audioBitrate("320k")
        .format("mp3")
        .outputOptions([
          "-map_metadata", "-1",
          "-id3v2_version", "3",
          "-metadata", `artist=${artist}`,
          "-metadata", `title=${title}`,
          "-metadata", "album=PulseWire"
        ]);

      if (track) command = command.outputOptions(["-metadata", `track=${track}`]);
      if (year) command = command.outputOptions(["-metadata", `date=${year}`]);
      if (genre) command = command.outputOptions(["-metadata", `genre=${genre}`]);

      command
        .on("end", resolve)
        .on("error", reject)
        .save(output);
    });

    res.download(output, `${title.replace(/[^\w\s-]/g, "").trim() || "song"}.mp3`, () => {
      fs.rm(input, { force: true }, () => {});
      fs.rm(output, { force: true }, () => {});
    });

  } catch (err) {
    fs.rm(input, { force: true }, () => {});
    fs.rm(output, { force: true }, () => {});
    console.error(err);
    res.status(500).json({
      error: "MP3 conversion failed.",
      details: err.message
    });
  }
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`PulseWire MP3 service running on port ${PORT}`);
});
EOF

cd ..

# Install local dependencies if Node/npm are available
if command -v npm >/dev/null 2>&1; then
  (
    cd mp3-service
    npm install
  ) || true
fi

# Patch admin.html using Python
python - <<'PY'
from pathlib import Path

p = Path("admin.html")
s = p.read_text()

old = '''<div id="ytPreview" style="margin-top:8px"></div>
      </div>
      <button class="btn" onclick="saveSong()">SAVE SONG</button>'''

new = '''<div id="ytPreview" style="margin-top:8px"></div>

        <div style="margin-top:10px;padding:10px;border:1px solid #2a2d3a;border-radius:7px">
          <div style="font-size:12px;color:#d1d5db;margin-bottom:7px">
            MP3 Converter — upload media you own or have permission to redistribute.
          </div>

          <input type="file" id="mp3SourceFile"
                 accept="audio/*,video/*"
                 style="width:100%;font-size:12px">

          <button type="button"
                  class="btn btn-sm btn-dark"
                  id="convertMp3Btn"
                  onclick="convertSelectedMedia()"
                  style="margin-top:8px">
            🎵 Convert to MP3
          </button>

          <div id="mp3ConvertStatus"
               style="font-size:12px;color:var(--muted);margin-top:7px"></div>
        </div>
      </div>
      <button class="btn" onclick="saveSong()">SAVE SONG</button>'''

if old not in s:
    raise SystemExit("Could not find YouTube section. No admin patch applied.")

s = s.replace(old, new, 1)

marker = '''async function searchYoutube(){'''

insert = r'''
async function convertSelectedMedia(){
  const file = document.getElementById('mp3SourceFile').files[0];
  const status = document.getElementById('mp3ConvertStatus');
  const btn = document.getElementById('convertMp3Btn');

  if(!file){
    alert('Choose the authorized audio/video file first.');
    return;
  }

  const title = document.getElementById('songTitle').value.trim();
  const artistSel = document.getElementById('songArtist');
  const artist = artistSel.options[artistSel.selectedIndex]?.text || 'Unknown Artist';

  if(!title){
    alert('Enter the song title first.');
    return;
  }

  /*
    Set this to the public URL of the deployed PulseWire MP3 service.
    Example:
    https://pulsewire-mp3.onrender.com
  */
  const MP3_SERVICE_URL =
    localStorage.getItem('pulsewireMp3ServiceUrl') ||
    'https://YOUR-MP3-SERVICE-URL';

  if(MP3_SERVICE_URL.includes('YOUR-MP3-SERVICE-URL')){
    alert('Set your deployed MP3 service URL first.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Converting...';
  status.textContent = 'Uploading media for conversion...';

  try{
    const form = new FormData();
    form.append('media', file);
    form.append('artist', artist);
    form.append('title', title);
    form.append('track', '');
    form.append('year', '');
    form.append('genre', '');

    const response = await fetch(MP3_SERVICE_URL + '/convert', {
      method:'POST',
      body:form
    });

    if(!response.ok){
      let message = 'Conversion failed.';
      try{
        const data = await response.json();
        if(data.error) message = data.error;
      }catch(_){}
      throw new Error(message);
    }

    status.textContent = 'Conversion complete. Uploading MP3...';

    const blob = await response.blob();
    const mp3File = new File(
      [blob],
      (title.replace(/[^\w\s-]/g,'').trim() || 'song') + '.mp3',
      {type:'audio/mpeg'}
    );

    const downloadUrl = await uploadCloud(
      mp3File,
      'mp3ConvertProg',
      'mp3ConvertBar'
    );

    if(!downloadUrl){
      throw new Error('MP3 upload did not return a URL.');
    }

    document.getElementById('songDownloadUrl').value = downloadUrl;

    status.textContent = '✓ MP3 converted and uploaded successfully.';
    btn.textContent = '✓ MP3 Ready';

  }catch(e){
    console.error(e);
    status.textContent = 'Conversion failed.';
    alert('MP3 conversion failed: ' + e.message);
    btn.textContent = '🎵 Convert to MP3';
  }finally{
    btn.disabled = false;
  }
}

'''

if marker not in s:
    raise SystemExit("Could not find searchYoutube(). No admin patch applied.")

s = s.replace(marker, insert + marker, 1)

# Add a progress bar next to the converter
needle = '''<div id="mp3ConvertStatus"
               style="font-size:12px;color:var(--muted);margin-top:7px"></div>'''

replacement = '''<div class="prog-wrap" id="mp3ConvertProg" style="margin-top:7px">
            <div class="prog-fill" id="mp3ConvertBar"></div>
          </div>
          <div id="mp3ConvertStatus"
               style="font-size:12px;color:var(--muted);margin-top:7px"></div>'''

s = s.replace(needle, replacement, 1)

p.write_text(s)
PY

echo
echo "=========================================="
echo " PulseWire MP3 setup created successfully"
echo "=========================================="
echo
echo "Created:"
echo "  ~/pulsewire-static/mp3-service/"
echo "  ~/pulsewire-static/admin.html (patched)"
echo
echo "Backup:"
ls -1t admin.html.mp3-backup-* 2>/dev/null | head -1 || true
echo
echo "Next:"
echo "1. Deploy mp3-service using its Dockerfile."
echo "2. Copy its public HTTPS URL."
echo "3. In admin.html, replace YOUR-MP3-SERVICE-URL with that URL."
echo "4. Deploy PulseWire normally."
echo
echo "IMPORTANT: The converter accepts media files you own or have permission to redistribute."

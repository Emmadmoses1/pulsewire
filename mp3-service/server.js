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

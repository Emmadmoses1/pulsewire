function isYouTubeUrl(value) {
  try {
    const url = new URL(String(value).trim());

    const allowedHosts = new Set([
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'music.youtube.com',
      'youtu.be',
      'www.youtu.be'
    ]);

    return url.protocol === 'https:' && allowedHosts.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

const app = require('./server-app');
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`WAVZO running on port ${PORT}`));

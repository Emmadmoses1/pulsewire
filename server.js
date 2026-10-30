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

// server-app.js starts the web server (and the search-engine watcher) itself.
// Listening again here made the app crash with "address already in use".
require('./server-app');

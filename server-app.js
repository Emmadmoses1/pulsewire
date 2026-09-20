const { JsonBinDB } = require('./jsonbin-db');
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const slugify = require('slugify');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');

const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, 'storage');
const DATA_DIR = path.join(STORAGE_DIR, 'data');
const UPLOADS_DIR = path.join(STORAGE_DIR, 'uploads');

const UPLOAD_DIRS = {
  images: path.join(UPLOADS_DIR, 'images'),
  music:  path.join(UPLOADS_DIR, 'music'),
  videos: path.join(UPLOADS_DIR, 'videos'),
};
Object.values(UPLOAD_DIRS).forEach(d => fs.mkdirSync(d, { recursive: true }));

const postUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (file.fieldname === 'musicFile')  return cb(null, UPLOAD_DIRS.music);
      if (file.fieldname === 'videoFile')  return cb(null, UPLOAD_DIRS.videos);
      cb(null, UPLOAD_DIRS.images);
    },
    filename: (req, file, cb) => {
      const prefix = file.fieldname === 'musicFile' ? 'music'
                   : file.fieldname === 'videoFile' ? 'video' : 'img';
      cb(null, prefix + '-' + Date.now() + path.extname(file.originalname));
    }
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = { coverImage: /^image\//, musicFile: /^audio\//, videoFile: /^video\// };
    const pattern = allowed[file.fieldname];
    if (!pattern) return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
    if (pattern.test(file.mimetype)) return cb(null, true);
    cb(new Error('Invalid file type for ' + file.fieldname));
  }
});

const postFields = postUpload.fields([
  { name: 'coverImage', maxCount: 1 },
  { name: 'musicFile',  maxCount: 1 },
  { name: 'videoFile',  maxCount: 1 },
]);

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new JsonBinDB(process.env.JSONBIN_KEY, { posts: [], articles: [], admin: { username: 'admin', password: 'changeme123' } });

async function safeRead(res, fallbackMsg = 'Something went wrong. Please try again shortly.') {
  try {
    await db.read();
    return true;
  } catch (err) {
    console.error('DB read failed:', err.message);
    res.status(503).send(fallbackMsg);
    return false;
  }
}

async function initDB() {
  try {
    await db.read();
  } catch (err) {
    console.error('initDB: read failed, starting with defaults:', err.message);
  }
  db.data ||= {};
  db.data.posts = db.data.posts || [];
  db.data.articles = db.data.articles || [];
  db.data.admin = db.data.admin || { username: 'admin', password: 'changeme123' };
  if (db.data.admin.password && !db.data.admin.password.startsWith('$2')) {
    db.data.admin.password = await bcrypt.hash(db.data.admin.password, 10);
  }
  try {
    await db.write();
  } catch (err) {
    console.error('initDB: write failed (will retry on next request):', err.message);
  }
}
initDB();

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public'), { index: false, maxAge: '1d' })); // FAST-SERVER
app.use('/posts', express.static(path.join(__dirname, 'posts'), { extensions: ['html'] }));
app.use('/songs', express.static(path.join(__dirname, 'songs'), { extensions: ['html'] }));
app.use('/artists', express.static(path.join(__dirname, 'artists'), { extensions: ['html'] }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/images', express.static(path.join(__dirname, 'images'), { maxAge: '7d' }));
app.get('/sitemap.xml', (req, res) => res.sendFile(path.join(__dirname, 'sitemap.xml')));
app.use('/data', require('express').static(path.join(__dirname, 'data'), { maxAge: '60s' }));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(__dirname, 'favicon.ico')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.post('/api/download-mp3', async (req, res) => {
  try {
    const { audioUrl, artist, title } = req.body || {};
    if (!audioUrl) return res.status(400).json({ error: 'Missing audioUrl' });
    const upstream = await fetch(audioUrl);
    if (!upstream.ok) return res.status(502).json({ error: 'Could not fetch source audio' });
    const buffer = Buffer.from(await upstream.arrayBuffer());
    const filename = ((artist || 'Unknown Artist') + ' - ' + (title || 'Track') + '.mp3').replace(/[\/\\:*?"<>|]/g, '');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.send(buffer);
  } catch (err) {
    console.error('download-mp3 error:', err.message);
    res.status(500).json({ error: 'Download failed' });
  }
});
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-session-secret-locally',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));

app.use(async (req, res, next) => {
  return next(); // visitor tracking is done by the pages + the Worker now; this made every home page load slow
  const skip = req.path.startsWith('/uploads') || req.path.startsWith('/css') ||
               req.path.startsWith('/js') || req.path.startsWith('/admin') ||
               req.path.startsWith('/api');
  if (!skip) {
    try {
      await db.read();
      db.data.views = db.data.views || [];
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      let country = 'Local';
      try {
        if (ip && ip !== '127.0.0.1' && ip !== '::1' && !ip.startsWith('192.168') && !ip.startsWith('10.')) {
          const geoRes = await fetch('http://ip-api.com/json/' + ip + '?fields=country');
          const geoData = await geoRes.json();
          if (geoData.country) country = geoData.country;
        }
      } catch (e) {}
      db.data.views.push({ path: req.path, ip, country, time: Date.now() });
      await db.write();
    } catch (err) {
      console.error('Visitor tracking failed (non-fatal):', err.message);
    }
  }
  next();
});

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.redirect('/admin/login');
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/artists.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'artists.html'));
});

app.post('/subscribe', async (req, res) => {
  if (!(await safeRead(res))) return;
  db.data.subscribers = db.data.subscribers || [];
  const email = (req.body.email || '').trim().toLowerCase();
  const posts = [...db.data.posts].reverse();
  let subMessage;
  if (!email || !email.includes('@')) {
    subMessage = 'Please enter a valid email.';
  } else if (db.data.subscribers.includes(email)) {
    subMessage = "You're already subscribed!";
  } else {
    db.data.subscribers.push(email);
    await db.write();
    subMessage = 'Thanks for subscribing!';
  }
  res.render('home', { posts, subMessage });
});

app.get('/post/:slug', async (req, res) => {
  if (!(await safeRead(res))) return;
  const post = db.data.posts.find(p => p.slug === req.params.slug);
  if (!post) return res.status(404).send('Post not found');
  post.views = (post.views || 0) + 1;
  await db.write();
  const related = db.data.posts
    .filter(p => p.slug !== post.slug && p.category === post.category)
    .slice(-3).reverse();
  res.render('post', { post, related });
});

app.post('/post/:slug/comment', async (req, res) => {
  if (!(await safeRead(res))) return;
  const post = db.data.posts.find(p => p.slug === req.params.slug);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const name = (req.body.name || 'Anonymous').trim().slice(0, 60);
  const text = (req.body.text || '').trim().slice(0, 1000);
  if (!text) return res.status(400).json({ error: 'Comment text required' });
  post.comments = post.comments || [];
  const comment = { id: 'c' + Date.now() + Math.random().toString(36).slice(2, 6), name, text, ts: Date.now(), likes: 0, replies: [] };
  post.comments.push(comment);
  await db.write();
  res.json({ comments: post.comments });
});

app.post('/post/:slug/comment/:commentId/reply', async (req, res) => {
  if (!(await safeRead(res))) return;
  const post = db.data.posts.find(p => p.slug === req.params.slug);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const comment = (post.comments || []).find(c => c.id === req.params.commentId);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  const name = (req.body.name || 'Anonymous').trim().slice(0, 60);
  const text = (req.body.text || '').trim().slice(0, 1000);
  if (!text) return res.status(400).json({ error: 'Reply text required' });
  comment.replies = comment.replies || [];
  comment.replies.push({ id: 'r' + Date.now() + Math.random().toString(36).slice(2, 6), name, text, ts: Date.now(), likes: 0 });
  await db.write();
  res.json({ comments: post.comments });
});

app.post('/post/:slug/comment/:commentId/like', async (req, res) => {
  if (!(await safeRead(res))) return;
  const post = db.data.posts.find(p => p.slug === req.params.slug);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const comment = (post.comments || []).find(c => c.id === req.params.commentId);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  comment.likes = (comment.likes || 0) + 1;
  await db.write();
  res.json({ comments: post.comments });
});

app.post('/post/:slug/comment/:commentId/reply/:replyId/like', async (req, res) => {
  if (!(await safeRead(res))) return;
  const post = db.data.posts.find(p => p.slug === req.params.slug);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const comment = (post.comments || []).find(c => c.id === req.params.commentId);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  const reply = (comment.replies || []).find(r => r.id === req.params.replyId);
  if (!reply) return res.status(404).json({ error: 'Reply not found' });
  reply.likes = (reply.likes || 0) + 1;
  await db.write();
  res.json({ comments: post.comments });
});

app.post('/post/:slug/reaction', async (req, res) => {
  if (!(await safeRead(res))) return;
  const post = db.data.posts.find(p => p.slug === req.params.slug);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const { key, previous } = req.body;
  const valid = ['like', 'love', 'laugh', 'wow', 'sad'];
  if (!valid.includes(key)) return res.status(400).json({ error: 'Invalid reaction' });
  post.reactions = post.reactions || {};
  if (previous === key) {
    post.reactions[key] = Math.max(0, (post.reactions[key] || 0) - 1);
  } else {
    if (previous && valid.includes(previous)) {
      post.reactions[previous] = Math.max(0, (post.reactions[previous] || 0) - 1);
    }
    post.reactions[key] = (post.reactions[key] || 0) + 1;
  }
  await db.write();
  res.json({ reactions: post.reactions });
});

app.get('/artists', async (req, res) => {
  if (!(await safeRead(res))) return;
  const artists = db.data.artists || [];
  const songs = db.data.songs || [];
  res.render('artists', { artists, songs });
});

app.get('/admin/login', (req, res) => res.render('admin-login', { error: null }));
app.post('/admin/login', async (req, res) => {
  if (!(await safeRead(res))) return;
  const { username, password } = req.body;
  const match = username === db.data.admin.username &&
                await bcrypt.compare(password, db.data.admin.password);
  if (match) { req.session.isAdmin = true; return res.redirect('/admin/dashboard'); }
  res.render('admin-login', { error: 'Wrong username or password' });
});
app.get('/admin/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

app.get('/admin/dashboard', requireAdmin, async (req, res) => {
  if (!(await safeRead(res))) return;
  const posts = [...db.data.posts].reverse();
  res.render('admin-dashboard', { posts });
});

app.get('/admin/export-backup', requireAdmin, async (req, res) => {
  if (!(await safeRead(res))) return;
  res.setHeader('Content-Disposition', 'attachment; filename=db-backup.json');
  res.json(db.data);
});

app.post('/admin/create-post', requireAdmin, postFields, async (req, res) => {
  if (!(await safeRead(res))) return;
  const { title, category, excerpt, content } = req.body;
  const slug = slugify(title, { lower: true, strict: true }) + '-' + Date.now();
  const coverImage = req.files?.coverImage?.[0] ? '/uploads/images/' + req.files.coverImage[0].filename : null;
  const musicFile  = req.files?.musicFile?.[0]  ? '/uploads/music/'  + req.files.musicFile[0].filename  : null;
  const videoFile  = req.files?.videoFile?.[0]  ? '/uploads/videos/' + req.files.videoFile[0].filename  : null;
  db.data.posts.push({
    title, slug, category, excerpt, content,
    coverImage, musicFile, videoFile,
    downloadCount: 0,
    date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
    createdAt: Date.now()
  });
  await db.write();
  res.redirect('/admin/dashboard');
});

app.get('/admin/edit-post/:slug', requireAdmin, async (req, res) => {
  if (!(await safeRead(res))) return;
  const post = db.data.posts.find(p => p.slug === req.params.slug);
  if (!post) return res.status(404).send('Post not found');
  res.render('admin-edit-post', { post });
});

app.post('/admin/edit-post/:slug', requireAdmin, postFields, async (req, res) => {
  if (!(await safeRead(res))) return;
  const post = db.data.posts.find(p => p.slug === req.params.slug);
  if (!post) return res.status(404).send('Post not found');
  const { title, category, excerpt, content } = req.body;
  post.title = title; post.category = category;
  post.excerpt = excerpt; post.content = content;
  if (req.files?.coverImage?.[0]) post.coverImage = '/uploads/images/' + req.files.coverImage[0].filename;
  if (req.files?.musicFile?.[0])  post.musicFile  = '/uploads/music/'  + req.files.musicFile[0].filename;
  if (req.files?.videoFile?.[0])  post.videoFile  = '/uploads/videos/' + req.files.videoFile[0].filename;
  await db.write();
  res.redirect('/admin/dashboard');
});

app.post('/admin/delete-post/:slug', requireAdmin, async (req, res) => {
  if (!(await safeRead(res))) return;
  db.data.posts = db.data.posts.filter(p => p.slug !== req.params.slug);
  await db.write();
  res.redirect('/admin/dashboard');
});

const { fetchTrustedNews, correctGrammar, scanCoverArt } = require('./routes-extra');
const facebookAuthRouter = require('./facebook-auth');
app.use(facebookAuthRouter);

app.post('/admin/post-to-facebook/:slug', requireAdmin, async (req, res) => {
  try {
    await db.read();
    const post = db.data.posts.find(p => p.slug === req.params.slug);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const conn = facebookAuthRouter.getFacebookConnection();
    if (!conn) return res.status(400).json({ error: 'No Facebook Page connected. Go to Settings and click Connect with Facebook.' });

    const postUrl = `https://wavzo.com.ng/posts/${post.slug}.html`;
    const caption = `${post.title}

Source: WAVZO

👉 Read the full story: ${postUrl}`;
    const absCover = post.coverImage ? (post.coverImage.startsWith('http') ? post.coverImage : `https://wavzo.com.ng${post.coverImage}`) : null;

    let apiUrl, body;
    if (absCover) {
      apiUrl = `https://graph.facebook.com/v21.0/${conn.pageId}/photos`;
      body = new URLSearchParams({ url: absCover, caption, access_token: conn.pageAccessToken });
    } else {
      apiUrl = `https://graph.facebook.com/v21.0/${conn.pageId}/feed`;
      body = new URLSearchParams({ message: caption, link: postUrl, access_token: conn.pageAccessToken });
    }

    const fbRes = await fetch(apiUrl, { method: 'POST', body });
    const data = await fbRes.json();

    if (data.id || data.post_id) {
      return res.json({ success: true, id: data.id || data.post_id });
    }
    console.error('Facebook post failed:', data);
    return res.status(400).json({ error: data.error?.error_user_msg || data.error?.message || 'Unknown error' });
  } catch (err) {
    console.error('post-to-facebook error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
app.get('/admin/news-suggestions', requireAdmin, async (req, res) => res.json(await fetchTrustedNews()));
app.post('/admin/ai-correct', requireAdmin, async (req, res) => res.json(await correctGrammar(req.body.text || '')));
app.post('/admin/ai-scan-cover', requireAdmin, async (req, res) => res.json(await scanCoverArt(req.body.imageBase64 || '', req.body.mediaType || '')));

app.get('/admin/analytics', requireAdmin, async (req, res) => {
  if (!(await safeRead(res))) return;
  const views = db.data.views || [];
  const totalViews = views.length;
  const uniqueVisitors = new Set(views.map(v => v.ip)).size;
  const countryCounts = {};
  views.forEach(v => { countryCounts[v.country] = (countryCounts[v.country] || 0) + 1; });
  const topCountries = Object.entries(countryCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const pathCounts = {};
  views.forEach(v => { if (v.path.startsWith('/post/')) pathCounts[v.path] = (pathCounts[v.path] || 0) + 1; });
  const topPosts = Object.entries(pathCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([p, count]) => {
    const slug = p.replace('/post/', '');
    const post = db.data.posts.find(x => x.slug === slug);
    return { title: post ? post.title : slug, count, slug };
  });
  const totalChats = (db.data.chats || []).length;
  res.render('admin-analytics', { totalViews, uniqueVisitors, topCountries, topPosts, totalChats });
});

app.post('/api/chat/send', async (req, res) => {
  if (!(await safeRead(res))) return;
  db.data.chats = db.data.chats || [];
  const { name, message, chatId } = req.body;
  const id = chatId || ('chat-' + Date.now());
  let chat = db.data.chats.find(c => c.id === id);
  if (!chat) { chat = { id, name: name || 'Visitor', messages: [], createdAt: Date.now() }; db.data.chats.push(chat); }
  chat.messages.push({ from: 'visitor', text: message, time: Date.now() });
  await db.write();
  res.json({ chatId: id });
});

app.get('/api/chat/:id', async (req, res) => {
  if (!(await safeRead(res))) return;
  const chat = (db.data.chats || []).find(c => c.id === req.params.id);
  res.json(chat || { messages: [] });
});

app.get('/admin/messages', requireAdmin, async (req, res) => {
  if (!(await safeRead(res))) return;
  const chats = [...(db.data.chats || [])].reverse();
  res.render('admin-messages', { chats });
});

app.post('/admin/chat/reply/:id', requireAdmin, async (req, res) => {
  if (!(await safeRead(res))) return;
  const chat = (db.data.chats || []).find(c => c.id === req.params.id);
  if (chat) { chat.messages.push({ from: 'admin', text: req.body.message, time: Date.now() }); await db.write(); }
  res.redirect('/admin/messages');
});

app.get('/download/:slug/:type', async (req, res) => {
  if (!(await safeRead(res))) return;
  const post = db.data.posts.find(p => p.slug === req.params.slug);
  if (!post) return res.status(404).send('Not found');
  const file = req.params.type === 'video' ? post.videoFile
             : req.params.type === 'audio' ? post.musicFile : null;
  if (!file) return res.status(400).send('Invalid type');
  post.downloadCount = (post.downloadCount || 0) + 1;
  await db.write();
  const filePath = path.join(STORAGE_DIR, file.replace(/^\/uploads\//, 'uploads/'));
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File not found');
  }
  res.download(filePath, path.basename(filePath));
});

app.get('/articles', async (req, res) => {
  if (!(await safeRead(res))) return;
  res.json([...(db.data.articles || [])].reverse());
});

app.get('/article/:slug', async (req, res) => {
  if (!(await safeRead(res))) return;
  const article = (db.data.articles || []).find(a => a.slug === req.params.slug);
  if (!article) return res.status(404).send('Not found');
  res.json(article);
});

app.post('/admin/create-article', requireAdmin, async (req, res) => {
  if (!(await safeRead(res))) return;
  const { title, category, body, author } = req.body;
  const slug = slugify(title, { lower: true, strict: true }) + '-' + Date.now();
  db.data.articles = db.data.articles || [];
  db.data.articles.push({
    title, slug, category, body,
    author: author || 'WAVZO Staff',
    date: new Date().toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }),
    createdAt: Date.now()
  });
  await db.write();
  res.redirect('/admin/dashboard');
});

app.post('/admin/delete-article/:slug', requireAdmin, async (req, res) => {
  if (!(await safeRead(res))) return;
  db.data.articles = (db.data.articles || []).filter(a => a.slug !== req.params.slug);
  await db.write();
  res.redirect('/admin/dashboard');
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message?.includes('Invalid file type')) {
    return res.status(400).send('Upload error: ' + err.message);
  }
  next(err);
});


// Proxy remote images — avoids Cloudinary URL-fetch preset restrictions
app.get('/api/proxy-image', async (req, res) => {
  const url = req.query.url;
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Missing url' });
  try {
    const upstream = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': url } });
    if (!upstream.ok) return res.status(502).json({ error: 'Upstream failed: ' + upstream.status });
    const ct = upstream.headers.get('content-type') || 'image/jpeg';
    if (!ct.startsWith('image/')) return res.status(400).json({ error: 'Not an image' });
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;

const PORT = process.env.PORT || 3000;
// Catch-all error handler — must be last, before app.listen
app.use((err, req, res, next) => {
  console.error('Unhandled route error:', err.message);
  if (res.headersSent) return next(err);
  res.status(500).send('Something went wrong on our end. Please try again shortly.');
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const slugify = require('slugify');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');

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
const adapter = new JSONFile(path.join(DATA_DIR, 'db.json'));
const db = new Low(adapter, { posts: [], articles: [], admin: { username: 'admin', password: 'changeme123' } });

async function initDB() {
  await db.read();
  db.data ||= { posts: [], articles: [], admin: { username: 'admin', password: 'changeme123' } };
  db.data.articles = db.data.articles || [];
  if (db.data.admin.password && !db.data.admin.password.startsWith('$2')) {
    db.data.admin.password = await bcrypt.hash(db.data.admin.password, 10);
  }
  await db.write();
}
initDB();

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.use('/posts', express.static(path.join(__dirname, 'posts'), { extensions: ['html'] }));
app.use('/songs', express.static(path.join(__dirname, 'songs'), { extensions: ['html'] }));
app.use('/artists', express.static(path.join(__dirname, 'artists'), { extensions: ['html'] }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-session-secret-locally',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));

app.use(async (req, res, next) => {
  const skip = req.path.startsWith('/uploads') || req.path.startsWith('/css') ||
               req.path.startsWith('/js') || req.path.startsWith('/admin') ||
               req.path.startsWith('/api');
  if (!skip) {
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
  }
  next();
});

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.redirect('/admin/login');
}

app.get('/', async (req, res) => {
  await db.read();
  const posts = [...db.data.posts].reverse();
  res.render('home', { posts, subMessage: null });
});

app.post('/subscribe', async (req, res) => {
  await db.read();
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
  await db.read();
  const post = db.data.posts.find(p => p.slug === req.params.slug);
  if (!post) return res.status(404).send('Post not found');
  const related = db.data.posts
    .filter(p => p.slug !== post.slug && p.category === post.category)
    .slice(-3).reverse();
  res.render('post', { post, related });
});

app.get('/admin/login', (req, res) => res.render('admin-login', { error: null }));
app.post('/admin/login', async (req, res) => {
  await db.read();
  const { username, password } = req.body;
  const match = username === db.data.admin.username &&
                await bcrypt.compare(password, db.data.admin.password);
  if (match) { req.session.isAdmin = true; return res.redirect('/admin/dashboard'); }
  res.render('admin-login', { error: 'Wrong username or password' });
});
app.get('/admin/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

app.get('/admin/dashboard', requireAdmin, async (req, res) => {
  await db.read();
  const posts = [...db.data.posts].reverse();
  res.render('admin-dashboard', { posts });
});

app.get('/admin/export-backup', requireAdmin, async (req, res) => {
  await db.read();
  res.setHeader('Content-Disposition', 'attachment; filename=db-backup.json');
  res.json(db.data);
});

app.post('/admin/create-post', requireAdmin, postFields, async (req, res) => {
  await db.read();
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
  await db.read();
  const post = db.data.posts.find(p => p.slug === req.params.slug);
  if (!post) return res.status(404).send('Post not found');
  res.render('admin-edit-post', { post });
});

app.post('/admin/edit-post/:slug', requireAdmin, postFields, async (req, res) => {
  await db.read();
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
  await db.read();
  db.data.posts = db.data.posts.filter(p => p.slug !== req.params.slug);
  await db.write();
  res.redirect('/admin/dashboard');
});

const { fetchTrustedNews, correctGrammar } = require('./routes-extra');
const facebookAuthRouter = require('./facebook-auth');
app.use(facebookAuthRouter);
app.get('/admin/news-suggestions', requireAdmin, async (req, res) => res.json(await fetchTrustedNews()));
app.post('/admin/ai-correct', requireAdmin, async (req, res) => res.json(await correctGrammar(req.body.text || '')));

app.get('/admin/analytics', requireAdmin, async (req, res) => {
  await db.read();
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
  await db.read();
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
  await db.read();
  const chat = (db.data.chats || []).find(c => c.id === req.params.id);
  res.json(chat || { messages: [] });
});

app.get('/admin/messages', requireAdmin, async (req, res) => {
  await db.read();
  const chats = [...(db.data.chats || [])].reverse();
  res.render('admin-messages', { chats });
});

app.post('/admin/chat/reply/:id', requireAdmin, async (req, res) => {
  await db.read();
  const chat = (db.data.chats || []).find(c => c.id === req.params.id);
  if (chat) { chat.messages.push({ from: 'admin', text: req.body.message, time: Date.now() }); await db.write(); }
  res.redirect('/admin/messages');
});

app.get('/download/:slug/:type', async (req, res) => {
  await db.read();
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
  await db.read();
  res.json([...(db.data.articles || [])].reverse());
});

app.get('/article/:slug', async (req, res) => {
  await db.read();
  const article = (db.data.articles || []).find(a => a.slug === req.params.slug);
  if (!article) return res.status(404).send('Not found');
  res.json(article);
});

app.post('/admin/create-article', requireAdmin, async (req, res) => {
  await db.read();
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
  await db.read();
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

module.exports = app;

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

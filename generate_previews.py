import json, os, subprocess

env_path = os.path.expanduser('~/pulsewire-static/.env')
key = None
with open(env_path) as f:
    for line in f:
        if line.startswith('JSONBIN_KEY='):
            key = line.strip().split('=', 1)[1]
            break
if not key:
    raise SystemExit("JSONBIN_KEY not found in functions/.env")

BIN_URL = 'https://wavzo-db.dakudinamoses.workers.dev/v3/b/6aa50e3aac6210605ac3c542/latest'
result = subprocess.run(
    ['curl', '-s', BIN_URL, '-H', f'X-Master-Key: {key}'],
    capture_output=True, text=True
)
data = json.loads(result.stdout)
posts = data.get('record', {}).get('posts', [])

with open('post.html', 'r') as f:
    template = f.read()

os.makedirs('posts', exist_ok=True)

for post in posts:
    slug = post.get('slug', '')
    if not slug:
        continue
    title = post.get('title', 'WAVZO')
    excerpt = (post.get('excerpt') or '')[:200].replace('"', "'")
    image = post.get('coverImage', '') or 'https://wavzo.com.ng/images/default-cover.jpg'
    url = f'https://wavzo.com.ng/posts/{slug}.html'

    page = template.replace(
        '<title>WAVZO</title>',
        f'''<title>{title} — WAVZO</title>
  <meta name="description" content="{excerpt}">
  <link rel="canonical" href="{url}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="{title}">
  <meta property="og:description" content="{excerpt}">
  <meta property="og:image" content="{image}">
  <meta property="og:url" content="{url}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{title}">
  <meta name="twitter:description" content="{excerpt}">
  <meta name="twitter:image" content="{image}">'''
    )

    page = page.replace(
        "let slug=new URLSearchParams(window.location.search).get('slug');",
        f"const slug='{slug}';"
    )

    with open(f'posts/{slug}.html', 'w') as f:
        f.write(page)

    print(f'Generated posts/{slug}.html')

print(f'Done — {len(posts)} post page(s) generated')

# ── Generate artist pages ──
artists = data.get('record', {}).get('artists', [])
if os.path.exists('artist.html'):
    with open('artist.html', 'r') as f:
        artist_template = f.read()
    os.makedirs('artists', exist_ok=True)
    for artist in artists:
        slug = artist.get('slug', '')
        if not slug:
            continue
        name = artist.get('name', 'Artist')
        bio = (artist.get('bio') or '')[:200].replace('"', "'")
        photo = artist.get('photo', '') or 'https://wavzo.com.ng/images/default-cover.jpg'
        url = f'https://wavzo.com.ng/artists/{slug}.html'

        page = artist_template.replace(
            '<title>WAVZO</title>',
            f'''<title>{name} — WAVZO</title>
  <meta name="description" content="{bio}">
  <link rel="canonical" href="{url}">
  <meta property="og:type" content="profile">
  <meta property="og:title" content="{name} — WAVZO">
  <meta property="og:description" content="{bio}">
  <meta property="og:image" content="{photo}">
  <meta property="og:url" content="{url}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{name} — WAVZO">
  <meta name="twitter:description" content="{bio}">
  <meta name="twitter:image" content="{photo}">'''
        )
        page = page.replace("const artistId='__ARTIST_ID__';", f"const artistId='{artist.get('id','')}';")

        with open(f'artists/{slug}.html', 'w') as f:
            f.write(page)
        print(f'Generated artists/{slug}.html')

# ── Generate song pages ──
songs = data.get('record', {}).get('songs', [])
if os.path.exists('song.html'):
    with open('song.html', 'r') as f:
        song_template = f.read()
    os.makedirs('songs', exist_ok=True)
    artists_by_id = {a.get('id'): a for a in artists}
    for song in songs:
        slug = song.get('slug', '')
        if not slug:
            continue
        title = song.get('title', 'Song')
        artist = artists_by_id.get(song.get('artistId'), {})
        artist_name = artist.get('name', 'WAVZO')
        excerpt = (song.get('excerpt') or f'{title} by {artist_name}')[:200].replace('"', "'")
        cover = song.get('cover', '') or 'https://wavzo.com.ng/images/default-cover.jpg'
        url = f'https://wavzo.com.ng/songs/{slug}.html'

        page = song_template.replace(
            '<title>WAVZO</title>',
            f'''<title>{title} — {artist_name} | WAVZO</title>
  <meta name="description" content="{excerpt}">
  <link rel="canonical" href="{url}">
  <meta property="og:type" content="music.song">
  <meta property="og:title" content="{title} — {artist_name}">
  <meta property="og:description" content="{excerpt}">
  <meta property="og:image" content="{cover}">
  <meta property="og:url" content="{url}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{title} — {artist_name}">
  <meta name="twitter:description" content="{excerpt}">
  <meta name="twitter:image" content="{cover}">'''
        )
        page = page.replace("const songId='__SONG_ID__';", f"const songId='{song.get('id','')}';")

        with open(f'songs/{slug}.html', 'w') as f:
            f.write(page)
        print(f'Generated songs/{slug}.html')

# ── Ping Google to index new pages ──
import urllib.request
sitemap_url = 'https://wavzo.com.ng/sitemap.xml'
try:
    urllib.request.urlopen(f'https://www.google.com/ping?sitemap={sitemap_url}')
    print('Google pinged successfully')
except Exception as e:
    print(f'Google ping failed: {e}')

# ── Save static db.json for fast homepage loading ──
import json as _json
_out = {'posts': posts, 'songs': songs, 'artists': artists}
with open('data/db.json', 'w') as _f:
    _json.dump(_out, _f)
print(f'Static db.json saved: {len(posts)} posts, {len(songs)} songs')

'use strict';
// ~/pulsewire-static/supabase-db.js
// Drop-in replacement for JsonBinDB while we migrate route by route.
// read()  -> rebuilds the same document shape (db.data) from Supabase, cached 15s
// write() -> NOT supported yet (throws), so nothing is silently lost
// Server only: uses the service role key from .env. Never send this file to the browser.
const { selectAll, rest, fromRows } = require('./supabase/lib');

class SupabaseDB {
  constructor(defaultData) {
    this.data = defaultData;
    this._at = 0;
    this._p = null;
  }
  async read() {
    if (this._at && Date.now() - this._at < 15000) return this.data;
    if (this._p) return this._p;
    this._p = (async () => {
      try {
        const R = {
          posts: await selectAll('posts', 'legacy_pos.asc'),
          post_comments: await selectAll('post_comments', 'id.asc'),
          songs: await selectAll('songs', 'legacy_pos.asc'),
          artists: await selectAll('artists', 'legacy_pos.asc'),
          country_views: await selectAll('country_views', 'country.asc'),
          page_views: await selectAll('page_views', 'id.asc'),
          site_settings: await selectAll('site_settings', 'key.asc'),
          site_secrets: await selectAll('site_secrets', 'key.asc'),
          admin_users: await selectAll('admin_users', 'username.asc')
        };
        this.data = fromRows(R);
        this._at = Date.now();
        return this.data;
      } finally { this._p = null; }
    })();
    return this._p;
  }
  async write() {
    throw new Error('SupabaseDB.write() is not migrated yet - this route still needs a Supabase version');
  }
  // atomic counters (no read-modify-write)
  async bumpPost(slug, field = 'views') {
    await rest('POST', 'rpc/bump_post_counter', { body: { p_slug: slug, p_field: field, p_by: 1 } });
  }
  // ---- comments / replies / likes / reactions (each returns the fresh value the route sends back)
  async _comments(slug) {
    const rows = await rest('GET', 'post_comments', { query: 'select=*&post_slug=eq.' + encodeURIComponent(slug) });
    return fromRows({ posts: [{ slug }], post_comments: rows }).posts[0].comments || [];
  }
  _remember(slug, comments) {
    const p = (this.data.posts || []).find((x) => x.slug === slug);
    if (p) p.comments = comments;
    return comments;
  }
  async addComment(slug, name, text) {
    const top = await rest('GET', 'post_comments', { query: 'select=pos&post_slug=eq.' + encodeURIComponent(slug) + '&parent_id=is.null&order=pos.desc&limit=1' });
    const id = 'c' + Date.now() + Math.random().toString(36).slice(2, 6);
    await rest('POST', 'post_comments', { body: { id, post_slug: slug, parent_id: null, pos: top.length ? top[0].pos + 1 : 0, name, body: text, ts_ms: Date.now(), likes: 0 }, prefer: 'return=minimal' });
    return this._remember(slug, await this._comments(slug));
  }
  async addReply(slug, commentId, name, text) {
    const last = await rest('GET', 'post_comments', { query: 'select=pos&parent_id=eq.' + encodeURIComponent(commentId) + '&order=pos.desc&limit=1' });
    const id = 'r' + Date.now() + Math.random().toString(36).slice(2, 6);
    await rest('POST', 'post_comments', { body: { id, post_slug: slug, parent_id: commentId, pos: last.length ? last[0].pos + 1 : 0, name, body: text, ts_ms: Date.now(), likes: 0 }, prefer: 'return=minimal' });
    return this._remember(slug, await this._comments(slug));
  }
  async likeComment(slug, id) { // works for comments and replies (ids are unique)
    await rest('POST', 'rpc/like_comment', { body: { p_slug: slug, p_id: id } });
    return this._remember(slug, await this._comments(slug));
  }
  async react(slug, key, previous) {
    const r = await rest('POST', 'rpc/react_post', { body: { p_slug: slug, p_key: key, p_prev: previous || null } });
    const p = (this.data.posts || []).find((x) => x.slug === slug);
    if (p && r) p.reactions = r;
    return r;
  }
  async bumpCountry(country) {
    await rest('POST', 'rpc/bump_country_view', { body: { p_country: country } });
  }
}
module.exports = { SupabaseDB };

const BIN_ID = '6aa50e3aac6210605ac3c542';
const BASE_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;

class JsonBinDB {
  constructor(key, defaultData) {
    this.key = key;
    this.data = defaultData;
  }
  async read() {
    const now = Date.now();
    if (this._cachedAt && (now - this._cachedAt) < 15000) {
      return this.data;
    }
    const res = await fetch(`${BASE_URL}/latest`, { headers: { 'X-Master-Key': this.key } });
    if (!res.ok) {
      if (this.data) return this.data;
      throw new Error(`JSONBin read failed: ${res.status}`);
    }
    this.data = (await res.json()).record;
    this._cachedAt = now;
    return this.data;
  }
  async write() {
    const res = await fetch(BASE_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': this.key },
      body: JSON.stringify(this.data)
    });
    if (!res.ok) throw new Error(`JSONBin write failed: ${res.status}`);
    return this.data;
  }
}
module.exports = { JsonBinDB };

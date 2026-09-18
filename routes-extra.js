require('dotenv').config();
const Parser = require('rss-parser');
const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail'],
      ['content:encoded', 'contentEncoded']
    ]
  }
});

const FEEDS = [
  { name: 'BBC', url: 'http://feeds.bbci.co.uk/news/rss.xml' },
  { name: 'Guardian', url: 'https://www.theguardian.com/world/rss' },
  { name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' }
];

function extractImage(item) {
  if (item.enclosure && item.enclosure.url) return item.enclosure.url;

  if (item.mediaContent) {
    const mc = Array.isArray(item.mediaContent) ? item.mediaContent[0] : item.mediaContent;
    if (mc && mc.$ && mc.$.url && mc.$.url !== 'undefined') return mc.$.url;
  }

  if (item.mediaThumbnail && item.mediaThumbnail.$ && item.mediaThumbnail.$.url) {
    return item.mediaThumbnail.$.url;
  }

  const html = item.contentEncoded || item.content || '';
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (match) return match[1];

  return null;
}

async function fetchTrustedNews() {
  let items = [];
  for (const feed of FEEDS) {
    try {
      const parsed = await parser.parseURL(feed.url);
      parsed.items.slice(0, 5).forEach(item => {
        items.push({
          source: feed.name,
          title: item.title,
          link: item.link,
          excerpt: item.contentSnippet ? item.contentSnippet.slice(0, 180) : '',
          image: extractImage(item)
        });
      });
    } catch (e) {
      console.log('Feed failed:', feed.name, e.message);
    }
  }
  return items;
}

async function correctGrammar(text) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'paste_your_key_here') {
    return { error: 'No API key set in .env file' };
  }
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [
        { role: 'user', content: 'Correct only the grammar, spelling, and punctuation of this article text. Do not change facts, tone, or add commentary. Return ONLY the corrected text, nothing else:\n\n' + text }
      ]
    })
  });
  const data = await response.json();
  if (data.content && data.content[0]) {
    return { corrected: data.content[0].text };
  }
  return { error: 'AI request failed' };
}

async function scanCoverArt(imageBase64, mediaType) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "paste_your_key_here") {
    return { error: "No API key set in .env file" };
  }
  if (!imageBase64) {
    return { error: "No image provided" };
  }
  const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  const safeMediaType = allowedTypes.includes(mediaType) ? mediaType : "image/jpeg";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: safeMediaType, data: imageBase64 }
            },
            {
              type: "text",
              text: "This is a music cover/single art image. Identify the song title and artist from any text visible on the image. Then write a short music-blog post about the track. Respond with ONLY a raw JSON object (no markdown, no code fences, no commentary) with exactly these keys: title (song title, or best guess, or empty string if truly unreadable), artist (artist name, or empty string if truly unreadable), excerpt (a punchy one-sentence teaser, under 160 characters), content (a short 2-3 paragraph write-up suitable for a music news post, written like a music blogger, do not invent specific facts you cannot see or infer from the image)."
            }
          ]
        }
      ]
    })
  });

  const data = await response.json();
  if (!data.content || !data.content[0]) {
    console.error("scan-cover: unexpected API response", data);
    return { error: "AI request failed" };
  }

  let raw = data.content[0].text.trim();
  raw = raw.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "").trim();

  try {
    const parsed = JSON.parse(raw);
    return {
      title: parsed.title || "",
      artist: parsed.artist || "",
      excerpt: parsed.excerpt || "",
      content: parsed.content || ""
    };
  } catch (e) {
    console.error("scan-cover: failed to parse AI JSON:", raw);
    return { error: "Could not parse AI response" };
  }
}

module.exports = { fetchTrustedNews, correctGrammar, scanCoverArt };

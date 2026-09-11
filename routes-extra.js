require('dotenv').config();
const Parser = require('rss-parser');
const parser = new Parser();

const FEEDS = [
  { name: 'BBC', url: 'http://feeds.bbci.co.uk/news/rss.xml' },
  { name: 'Reuters', url: 'https://feeds.reuters.com/reuters/topNews' },
  { name: 'AP', url: 'https://apnews.com/apf-topnews' }
];

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
          image: (item.enclosure && item.enclosure.url) ? item.enclosure.url : null
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

module.exports = { fetchTrustedNews, correctGrammar };

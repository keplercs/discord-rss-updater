const Parser = require('rss-parser');
const parser = new Parser();
const fs = require('fs');

const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
const WEBHOOK_CS2 = process.env.DISCORD_WEBHOOK_CS2;
const WEBHOOK_FACEIT = process.env.DISCORD_WEBHOOK_FACEIT;

async function sendDiscord(webhookUrl, embed) {
  if (!webhookUrl) return;
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] })
  });
}

async function cleanHTML(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n- ')
    .replace(/<[^>]+>/g, '')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

async function translateText(text) {
  const res = await fetch('https://api-free.deepl.com/v2/translate', {
    method: 'POST',
    headers: { 'Authorization': `DeepL-Auth-Key ${DEEPL_API_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ text, target_lang: 'ES', source_lang: 'EN' })
  });
  const data = await res.json();
  return data.translations[0].text;
}

async function processFeed(name, url, webhook, isFaceit = false) {
  const lastSeenFile = `last_seen_${name}.txt`;
  const lastSeen = fs.existsSync(lastSeenFile) ? fs.readFileSync(lastSeenFile, 'utf8').trim() : '';
  
  const feed = await parser.parseURL(url);
  const item = feed.items[0]; // Último artículo
  
  if (item.guid === lastSeen || item.link === lastSeen) {
    console.log(`[${name}] Sin novedades.`);
    return;
  }

  console.log(`[${name}] Nueva actualización detectada.`);
  fs.writeFileSync(lastSeenFile, item.guid || item.link);

  let description = cleanHTML(item.content || item.contentSnippet || item.description);

  if (isFaceit && DEEPL_API_KEY) {
    description = await translateText(description);
  }

  const embed = {
    title: item.title,
    description: description,
    color: isFaceit ? 16733440 : 2636413,
    url: item.link,
    image: { url: isFaceit ? 'https://www.faceitstatus.com/og-image.png' : 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/730/162664aa5da85f418105350c5d67ca565f6c3713/header.jpg' },
    author: {
      name: isFaceit ? 'Enlace del incidente' : 'Detalles sobre la actualización',
      icon_url: isFaceit ? 'https://www.faceitstatus.com/_next/image?url=https%3A%2F%2Fstorage.googleapis.com%2Fincident-io-status-page-logos%2F01GEF2KCCR92BE94Q9GPWW36BM%2Ffaceit%2F8v97t78c.png&w=384&q=75' : 'https://shared.fastly.steamstatic.com/community_assets/images/apps/730/8dbc71957312bbd3baea65848b545be9eae2a355.jpg'
    }
  };

  await sendDiscord(webhook, embed);
}

async function main() {
  await processFeed('cs2', 'https://store.steampowered.com/feeds/news/app/730/?l=spanish', WEBHOOK_CS2, false);
  await processFeed('faceit', 'https://www.faceitstatus.com/feed.rss', WEBHOOK_FACEIT, true);
}

main().catch(console.error);
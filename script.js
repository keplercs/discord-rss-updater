const Parser = require('rss-parser');
const parser = new Parser();
const fs = require('fs');

const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
const DEEPL_GLOSSARY_ID = 'b08dfba2-a6dd-478b-a6a3-91f74822e466'; // Del blueprint
const WEBHOOK_CS2 = process.env.DISCORD_WEBHOOK_CS2;
const WEBHOOK_FACEIT = process.env.DISCORD_WEBHOOK_FACEIT;

async function sendDiscord(webhookUrl, embed) {
  if (!webhookUrl) {
    console.log('Webhook URL vacío, omitiendo envío');
    return;
  }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] })
    });
    if (!res.ok) {
      console.error(`Error Discord: ${res.status} ${res.statusText}`);
    } else {
      console.log('Mensaje enviado a Discord correctamente');
    }
  } catch (err) {
    console.error('Error enviando a Discord:', err);
  }
}

async function cleanHTML(html) {
  if (!html) return '';
  // Si viene como objeto (algunos RSS), extraer texto
  const text = typeof html === 'object' ? (html._ || html['#text'] || JSON.stringify(html)) : html;
  return String(text)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

// Replica exacta del blueprint: envía "título|||\ndescripción" y hace split después
async function translateFaceitContent(title, description) {
  if (!DEEPL_API_KEY) {
    console.log('Sin DEEPL_API_KEY, omitiendo traducción');
    return { title, description };
  }
  
  const combinedText = `${title}|||\n${description}`;
  console.log('Enviando a DeepL:', combinedText.substring(0, 100) + '...');
  
  try {
    const res = await fetch('https://api-free.deepl.com/v2/translate', {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${DEEPL_API_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        text: combinedText,
        target_lang: 'ES',
        source_lang: 'EN',
        glossary_id: DEEPL_GLOSSARY_ID,
        tag_handling: 'html',
        preserve_formatting: 'true'
      })
    });
    
    if (!res.ok) {
      const errorText = await res.text();
      console.error(`DeepL error ${res.status}: ${errorText}`);
      return { title, description };
    }
    
    const data = await res.json();
    const translated = data.translations[0].text;
    
    // Split igual que Make: {{get(split(3.translations[].text; "|||"); 1)}} y 2
    const parts = translated.split('|||\n');
    return {
      title: parts[0] || title,
      description: parts[1] || description
    };
  } catch (err) {
    console.error('Error en traducción:', err);
    return { title, description };
  }
}

async function processFeed(name, url, webhook, isFaceit = false) {
  const lastSeenFile = `last_seen_${name}.txt`;
  const lastSeen = fs.existsSync(lastSeenFile) ? fs.readFileSync(lastSeenFile, 'utf8').trim() : '';
  
  try {
    const feed = await parser.parseURL(url);
    const item = feed.items[0];
    
    if (!item) {
      console.log(`[${name}] No hay artículos en el feed`);
      return;
    }
    
    const currentId = item.guid || item.link;
    if (currentId === lastSeen) {
      console.log(`[${name}] Sin novedades (mismo guid: ${currentId})`);
      return;
    }

    console.log(`[${name}] Nueva actualización: ${item.title}`);
    fs.writeFileSync(lastSeenFile, currentId);

    let title = item.title || '';
    let description = cleanHTML(item.content || item.contentSnippet || item.description);

    if (isFaceit) {
      console.log(`[${name}] Traduciendo con glosario...`);
      const translated = await translateFaceitContent(title, description);
      title = translated.title;
      description = translated.description;
    }

    const embed = {
      title: title,
      // SIN url aquí para que el título no sea clickeable (el autor ya tiene el link)
      description: description,
      color: isFaceit ? 16733440 : 2636413,
      image: {
        url: isFaceit
          ? 'https://www.faceitstatus.com/og-image.png'
          : 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/730/162664aa5da85f418105350c5d67ca565f6c3713/header.jpg'
      },
      author: {
        name: isFaceit ? 'Enlace del incidente' : 'Detalles sobre la actualización',
        url: item.link,
        icon_url: isFaceit
          ? 'https://www.faceitstatus.com/_next/image?url=https%3A%2F%2Fstorage.googleapis.com%2Fincident-io-status-page-logos%2F01GEF2KCCR92BE94Q9GPWW36BM%2Ffaceit%2F8v97t78c.png&w=384&q=75'
          : 'https://shared.fastly.steamstatic.com/community_assets/images/apps/730/8dbc71957312bbd3baea65848b545be9eae2a355.jpg'
      }
    };

    await sendDiscord(webhook, embed);
  } catch (err) {
    console.error(`[${name}] Error:`, err);
  }
}

async function main() {
  await processFeed('cs2', 'https://store.steampowered.com/feeds/news/app/730/?l=spanish', WEBHOOK_CS2, false);
  await processFeed('faceit', 'https://www.faceitstatus.com/feed.rss', WEBHOOK_FACEIT, true);
}

main().catch(console.error);

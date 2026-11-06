const Parser = require('rss-parser');
const parser = new Parser();
const fs = require('fs');

const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
const DEEPL_GLOSSARY_ID = 'b08dfba2-a6dd-478b-a6a3-91f74822e466';
const WEBHOOK_CS2 = process.env.DISCORD_WEBHOOK_CS2;
const WEBHOOK_FACEIT = process.env.DISCORD_WEBHOOK_FACEIT;
const FORCE_SEND = process.env.FORCE_SEND === 'true';

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
      console.log('✓ Mensaje enviado a Discord');
    }
  } catch (err) {
    console.error('Error enviando a Discord:', err);
  }
}

function cleanHTML(html, isFaceit = false) {
  if (!html) return '';
  
  // Extraer texto de objetos RSS si es necesario
  let text = typeof html === 'string' ? html : 
             (html._ || html['#text'] || html.content || JSON.stringify(html));
  
  if (isFaceit) {
    // === FORMATO COMPACTO PARA FACEIT ===
    return text
      // 1. Traducir y formatear etiquetas específicas
      .replace(/<b>Status:\s*([^<]+)<\/b>/gi, 'Estado: $1\n')
      .replace(/<b>Affected components<\/b>/gi, 'Componentes afectados:\n')
      // 2. Convertir HTML básico a texto
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li>/gi, '\n* ') // Viñeta con * (Markdown de Discord)
      .replace(/<\/li>/gi, '')
      .replace(/<\/?ul>/gi, '')
      .replace(/<\/?ol>/gi, '')
      .replace(/<[^>]+>/g, '')
      // 3. Decodificar entidades
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      // 4. COLAPSAR TODOS los saltos de línea a uno solo para el diseño compacto de Faceit
      .replace(/\n{2,}/g, '\n')
      .trim();
  } else {
    // === FORMATO PARA CS2 ===
    return text
      // 1. Convertir HTML básico a texto
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<li>/gi, '\n* ') // Viñeta con * (Markdown de Discord)
      .replace(/<\/li>/gi, '')
      .replace(/<\/?ul>/gi, '\n')
      .replace(/<\/?ol>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      // 2. Decodificar entidades
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      // 3. Headers entre corchetes a negrita: [ JUGABILIDAD ] -> **JUGABILIDAD**
      .replace(/\[\s*([^\]]+?)\s*\]/g, '**$1**\n')
      // 4. Limpiar viñetas huérfanas
      .replace(/^\s*\*\s*$/gm, '')
      // 5. Normalizar saltos (máximo doble salto para separar secciones)
      .replace(/\n{3,}/g, '\n\n')
      // 6. Asegurar doble salto ANTES de la primera viñeta si sigue a un texto
      .replace(/([^\n])\n(\* )/g, '$1\n\n$2')
      // 7. Limpiar triple salto accidental del paso anterior
      .replace(/\n{3,}/g, '\n\n')
      // 8. CRÍTICO: Eliminar saltos de línea DOBLES ENTRE viñetas para mantener la lista compacta
      .replace(/(\n\* [^\n]*)\n{2,}(\* )/g, '$1\n$2')
      // 9. Limpieza final
      .replace(/^\n+|\n+$/g, '')
      .trim();
  }
}

async function translateFaceitContent(title, description) {
  if (!DEEPL_API_KEY) {
    console.log('Sin DEEPL_API_KEY, omitiendo traducción');
    return { title, description };
  }
  
  const combinedText = `${title}|||\n${description}`;
  console.log('Enviando a DeepL (primeros 100 chars):', combinedText.substring(0, 100));
  
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
        preserve_formatting: 'true'
      })
    });
    
    if (!res.ok) {
      const errorText = await res.text();
      console.error(`DeepL error ${res.status}: ${errorText}`);
      return { title, description };
    }
    
    const data = await res.json();
    console.log('Respuesta DeepL recibida');
    
    const translated = data.translations[0].text;
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
    
    if (currentId === lastSeen && !FORCE_SEND) {
      console.log(`[${name}] Sin novedades (mismo guid)`);
      return;
    }

    console.log(`[${name}] Procesando: ${item.title}`);
    
    if (!FORCE_SEND) {
      fs.writeFileSync(lastSeenFile, currentId);
    }

    let title = item.title || '';
    let description = cleanHTML(item.content || item.contentSnippet || item.description, isFaceit);
    
    console.log(`[${name}] Descripción limpia (primeros 100 chars):`, description.substring(0, 100));

    if (isFaceit) {
      console.log(`[${name}] Traduciendo con glosario...`);
      const translated = await translateFaceitContent(title, description);
      title = translated.title;
      description = translated.description;
      console.log(`[${name}] Traducción completada`);
    }

    const embed = {
      title: title,
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
  console.log('=== Iniciando RSS Updater ===');
  console.log('FORCE_SEND:', FORCE_SEND);
  
  await processFeed('cs2', 'https://store.steampowered.com/feeds/news/app/730/?l=spanish', WEBHOOK_CS2, false);
  await processFeed('faceit', 'https://www.faceitstatus.com/feed.rss', WEBHOOK_FACEIT, true);
  
  console.log('=== Proceso completado ===');
}

main().catch(console.error);

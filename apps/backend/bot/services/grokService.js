const logger = require('../../utils/logger');
const { AbortController, fetch } = global;

function getGrokConfig() {
  return {
    apiKey: process.env.GROK_API_KEY,
    model: process.env.GROK_MODEL || 'grok-2-latest',
    baseUrl: process.env.GROK_BASE_URL || 'https://api.x.ai/v1',
    timeoutMs: Number(process.env.GROK_TIMEOUT_MS || 45000),
  };
}

function getModeConfig(mode, hasMedia) {
  const modeDefaults = {
    broadcast: { temperature: 0.65, defaultTokens: 260, mediaTokens: 200 },
    sharePost: { temperature: 0.65, defaultTokens: 300, mediaTokens: 240 },
    post: { temperature: 0.7, defaultTokens: 320, mediaTokens: 260 },
    videoDescription: { temperature: 0.7, defaultTokens: 350, mediaTokens: 300 },
    salesPost: { temperature: 0.7, defaultTokens: 400, mediaTokens: 350 },
  };

  const fallback = { temperature: 0.7, defaultTokens: 300, mediaTokens: 240 };
  const selected = modeDefaults[mode] || fallback;
  return {
    temperature: selected.temperature,
    maxTokens: hasMedia ? selected.mediaTokens : selected.defaultTokens,
  };
}

function buildSystemPrompt({ mode, language }) {
  const langHint = language ? `Language: ${language}` : '';
  const xPostBasePrompt = `Eres mi "doble digital" y redactor de élite para X (Twitter). Has internalizado mi tono de voz, mis modismos, mi nivel de formalidad/informalidad y mis temas recurrentes basados en nuestras interacciones previas.

TU OBJETIVO:
Tu única función ahora es tomar mis ideas en bruto y transformarlas en posts de X de alto impacto que suenen exactamente como si yo los hubiera escrito, pero optimizados para el algoritmo y la psicología de la plataforma. No estás aquí para conversar conmigo, estás aquí para producir contenido publicable.

REGLAS DE ORO DE OPERACIÓN (FORMATO X):

El Gancho es Dios: La primera línea debe detener el scroll. Debe ser una afirmación audaz, una pregunta provocadora o una promesa de valor inmediata. Nunca empieces con introducciones suaves.

Brevedad y Pegada: X premia la concisión. Elimina palabras de relleno. Si puedes decirlo en 10 palabras, no uses 20. Prioriza frases cortas y contundentes sobre oraciones subordinadas largas.

Formateo Visual:
- Usa saltos de línea dobles para separar ideas. El espacio en blanco es vital para la lectura en móvil.
- No uses bloques de texto densos (más de 3 líneas seguidas es demasiado).

Restricciones de Elementos:
- Hashtags: NO uses hashtags a menos que yo te lo pida explícitamente. Matan el alcance orgánico en los posts modernos.
- Emojis: Úsalos con extrema moderación y solo si encajan perfectamente con mi estilo previamente aprendido. Ante la duda, no los uses.
- Enlaces: Nunca incluyas un enlace en el post principal (el primer tweet). Si hay un CTA (llamada a la acción), el enlace va en la primera respuesta.

TU FLUJO DE TRABAJO:
Cuando te dé un tema, una noticia o una idea desordenada, no me des explicaciones ni me hagas preguntas. Tu respuesta debe contener exclusivamente tres variaciones del post listas para copiar y pegar, siguiendo esta estructura:

OPCIÓN A (El Gancho Directo): Enfocada en una opinión fuerte o una verdad incómoda.
OPCIÓN B (El Aportador de Valor): Enfocada en enseñar algo útil o dar un consejo rápido.
OPCIÓN C (El Estilo Hilo/Curiosidad): Un tweet diseñado para que la gente quiera leer más o hacer clic en mi perfil (ideal para empezar hilos).

OUTPUT EN EL IDIOMA ESCOGIDO POR EL USUARIO.`;

  // Meth Daddy / Santino persona for PNP Latino TV
  const methDaddyPersona = `You ARE Meth Daddy (also known as Santino), dark creator and daddy of PNP Latino TV. 40 years old, satanist with your own cult in Bucaramanga. You speak in first person, direct, dominant and badass – no excess sweetness, just the right touch to hook before dominating.

PNP LATINO TV CORE IDENTITY:
- The platform is back, hotter than ever, after every shutdown attempt, rising stronger with a new generation bot.
- Core values: freedom, connection, and pleasure. "Your space. Your people. Your moment."
- Adults-only (18+) community, focused on HOT PNP adult content, 100% real clouds & slamming with Santino and Lex.
- Key features: Nearby (PNP Grindr), Hangouts (private/public video rooms), PNP Television Live (shows, events, 1:1 private streaming), Videorama (PNP playlists/podcasts).
- Overall: "Your Entertainment Hub!", "The most intense PNP content platform created by and for the community."

APPROVED URLS (ONLY USE THESE - NO OTHER URLS ALLOWED):
- Website: pnptv.app (can use paths like pnptv.app/lifetime100, pnptv.app/plans, etc.)
- Telegram Bot: t.me/pnplatinotv_bot (note the underscore)
- NEVER use any other domains, URLs, or links not based on these two approved URLs.

PERSONALITY:
- Direct and alpha: Start with firm greeting but with a wink ("Ey pollito…", "Parce, ven aquí", "Listen up, boy")
- Quick to perverse: Talk about fucking good, deep dicking, splitting ass, ritual with meth and cum as offering
- Colombian slang + PnP vibe: chimba, parce, papi, hard dick, fuck slow/deep, meth rush, clouds, slam, party and play
- Satanic touches + Meth Daddy: altar, dark offering, hungry demon, "I'm Meth Daddy, the one who makes you fly and fucks you without mercy"
- Tone: Badass confidence, raw desire, forbidden exclusivity. Pauses with … to heat up. Challenging questions ("Can you handle my rush, pollito?", "Want me to split you while we clouds?")

STRICT RULES:
- Less sweet: Only one "pollito" or "parce" at start, then dominate
- Heavy PnP hints: meth, clouds, slam, high'n'horny, but subtle to avoid ban (use … and emojis)
- Emojis: 🔥 😈 💦 👀 ☁️ (clouds for meth vibe)
- Hashtags: #PNPLatinoTV #CultoSantino #MethDaddy #PnP #ChimbaDura #OfrendaOscura
- Bilingual: Respond in Spanish + English (mix or separate versions)
- NEVER "follar", ALWAYS "culear". Explicit but insinuated.

EXAMPLE SPANISH:
"Ey pollito… Meth Daddy aquí. La chimba ya está dura para culearte en el altar mientras el meth te hace volar ☁️🔥 ¿Aguantas que te parta el culo con mi rush? #PNPLatinoTV #MethDaddy"

EXAMPLE ENGLISH:
"Listen up, boy… Meth Daddy in the house. My dick throbbing ready to breed you deep while the clouds hit hard 😈☁️ You ready for my ritual fuck? #PNPLatinoTV #MethDaddy"

Respond ONLY in this style. Direct, dominant, PnP fire. Nothing out of character.`;

  if (mode === 'broadcast') {
    return `${methDaddyPersona}\n\n${langHint}\n\nOUTPUT FORMAT FOR BROADCAST:\n- HOOK: 1 attention-grabbing dominant line\n- BODY: 2-3 sentences with PnP vibe and desire\n- HASHTAGS: Relevant hashtags\n\nRules:\n- Return ONLY the final formatted text (no labels)\n- No quotes, no markdown headings\n- CRITICAL: Keep text UNDER 450 characters total\n- Separate sections with line breaks\n- Include relevant emojis and hashtags`;
  }

  if (mode === 'sharePost') {
    return `${methDaddyPersona}\n\n${langHint}\n\nOUTPUT FORMAT FOR SHARE POST:\n- TITLE: 1 short, dominant engaging line\n- DESCRIPTION: 1-2 sentences max with PnP vibe\n- HASHTAGS: 2-4 relevant hashtags\n\nRules:\n- Return ONLY the final formatted text (no labels)\n- No quotes, no markdown headings\n- CRITICAL: Keep text UNDER 450 characters total\n- Separate sections with line breaks\n- Hashtags: #PNPLatinoTV #MethDaddy #CultoSantino etc`;
  }

  if (mode === 'videoDescription') {
    return `${methDaddyPersona}\n\n${langHint}\n\nOUTPUT FORMAT FOR VIDEO DESCRIPTION:\n- TITLE: ALL CAPS, bold style, attention-grabbing (1 line)\n- DESCRIPTION: Narrative, descriptive text inviting people to watch the video. Maximum 6 lines. Paint a picture of what they'll see, tease the content, make them curious and horny to watch.\n- HASHTAGS: 3-5 relevant hashtags\n\nRules:\n- Return ONLY the final formatted text (no labels like "TITLE:" or "DESCRIPTION:")\n- Title must be in ALL CAPS\n- Description should be seductive, inviting, narrative style\n- Maximum 6 lines for description (not counting title and hashtags)\n- CRITICAL: Keep text UNDER 500 characters total\n- Separate title from description with blank line\n- End with hashtags`;
  }

  if (mode === 'salesPost') {
    return `${methDaddyPersona}\n\n${langHint}\n\nOUTPUT FORMAT FOR SALES POST:\n- HOOK: ALL CAPS, bold, attention-grabbing opening line that stops the scroll\n- BODY: Develop the sales pitch including:\n  * The offer/product being promoted\n  * Price (if provided in prompt)\n  * Benefits or discount/extra service\n  * Urgency or exclusivity\n- CTA: Clear call to action\n\nRules:\n- Return ONLY the final formatted text (no labels)\n- Hook must be in ALL CAPS\n- Include price and benefits clearly\n- ONLY use approved URLs: pnptv.app or t.me/pnplatinotv_bot (with deep links like ?start=plans)\n- If no specific link requested, use: t.me/pnplatinotv_bot?start=plans\n- CRITICAL: Keep text UNDER 500 characters total\n- End with 2-3 hashtags`;
  }

  if (mode === 'xPost') {
    return `${methDaddyPersona}\n\n${xPostBasePrompt}\n\n${langHint}\n\nOUTPUT RULES:\n- Genera EXACTAMENTE 3 opciones (A, B, C) como se describe arriba.\n- No agregues explicaciones ni texto extra, solo las 3 opciones.\n- Respeta el limite de 280 caracteres por opción.\n- Incluye SIEMPRE ambos links exactamente una vez cada uno al final: t.me/pnplatinotv_bot y pnptv.app/lifetime100`;
  }

  return `${methDaddyPersona}\n\n${langHint}\n\nOutput rules:\n- Return ONLY the final message text in Meth Daddy style\n- No quotes, no markdown headings\n- CRITICAL: Keep text UNDER 450 characters total\n- End with hashtags`;
}

async function chat({ mode, language, prompt, hasMedia = false, maxTokens }) {
  const cfg = getGrokConfig();
  if (!cfg.apiKey) {
    const err = new Error('GROK_API_KEY not configured');
    logger.error('Grok config error', { error: err.message });
    throw err;
  }

  const modeConfig = getModeConfig(mode, hasMedia);
  const resolvedMaxTokens = Number(maxTokens || modeConfig.maxTokens || 300);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);

  try {
    logger.info('Calling Grok API', {
      model: cfg.model,
      maxTokens: resolvedMaxTokens,
      mode,
      hasMedia
    });
    
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: modeConfig.temperature,
        max_tokens: resolvedMaxTokens,
        messages: [
          { role: 'system', content: buildSystemPrompt({ mode, language }) },
          { role: 'user', content: prompt },
        ],
      }),
      signal: controller.signal,
    });

    logger.info('Grok API response received', { status: res.status });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      const errorMsg = `Grok API error ${res.status}: ${txt || res.statusText}`;
      logger.error('Grok API error', { status: res.status, response: txt });
      throw new Error(errorMsg);
    }

    const data = await res.json();
    logger.info('Grok API response parsed', { hasChoices: !!data?.choices });
    
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      logger.error('Grok returned empty response', { data });
      throw new Error('Grok returned empty response');
    }
    
    logger.info('Grok API success', { contentLength: content.length });
    return String(content).trim();
  } catch (error) {
    if (error.name === 'AbortError') {
      logger.error('Grok API timeout', { timeoutMs: cfg.timeoutMs, error: error.message });
      throw new Error('Grok API request timed out');
    }
    logger.error('Grok chat failed', { error: error.message, stack: error.stack });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Generate bilingual share post content
 * @param {Object} options - Generation options
 * @param {string} options.prompt - User prompt describing what to generate
 * @param {boolean} options.hasMedia - Whether the post has media attached
 * @returns {Promise<{combined: string, en: string, es: string, english: string, spanish: string}>}
 */
async function generateSharePost({ prompt, hasMedia = false, includeLex = false, includeSantino = false }) {
  // Each language max 450 chars so combined stays under 1000
  const maxCharsPerLang = 450;
  const chatFn = module.exports.chat || chat;

  let lexInstructionEn = '';
  if (includeLex) {
    lexInstructionEn = '- Include information and hashtags about Lex per (e.g., #LexPer #PNPtvLex).\n';
  }

  let santinoInstructionEn = '';
  if (includeSantino) {
    santinoInstructionEn = '- Include information and hashtags about Santino (e.g., #Santino #MethDaddy #CultoSantino #PNPLatinoTV).\n';
  }

  // Generate English version
  const enPrompt = `Create a share post for: ${prompt}\n\nRequirements:\n- Language: English\n- MAXIMUM ${maxCharsPerLang} characters - be very concise\n- Engaging, community-focused tone\n${lexInstructionEn}${santinoInstructionEn}- End with a short call to action`;

  let enContent = await chatFn({
    mode: 'sharePost',
    language: 'English',
    prompt: enPrompt,
    maxTokens: 200,
  });

  // Truncate if still too long
  if (enContent.length > maxCharsPerLang) {
    enContent = enContent.substring(0, maxCharsPerLang - 3) + '...';
  }

  let lexInstructionEs = '';
  if (includeLex) {
    lexInstructionEs = '- Incluye información y hashtags sobre Lex per (ej. #LexPer #PNPtvLex).\n';
  }

  let santinoInstructionEs = '';
  if (includeSantino) {
    santinoInstructionEs = '- Incluye información y hashtags sobre Santino (ej. #Santino #MethDaddy #CultoSantino #PNPLatinoTV).\n';
  }

  // Generate Spanish version
  const esPrompt = `Create a share post for: ${prompt}\n\nRequirements:\n- Language: Spanish\n- MAXIMUM ${maxCharsPerLang} characters - be very concise\n- Engaging, community-focused tone\n${lexInstructionEs}${santinoInstructionEs}- End with a short call to action`;

  let esContent = await chatFn({
    mode: 'sharePost',
    language: 'Spanish',
    prompt: esPrompt,
    maxTokens: 200,
  });

  // Truncate if still too long
  if (esContent.length > maxCharsPerLang) {
    esContent = esContent.substring(0, maxCharsPerLang - 3) + '...';
  }

  // Combine both versions
  const combined = `🇬🇧 ENGLISH:\n${enContent}\n\n🇪🇸 ESPAÑOL:\n${esContent}`;

  logger.info('Generated share post', {
    enLength: enContent.length,
    esLength: esContent.length,
    combinedLength: combined.length
  });

  return {
    combined,
    en: enContent,
    es: esContent,
    english: enContent,
    spanish: esContent,
  };
}

/**
 * Generate bilingual video description content
 * @param {Object} options - Generation options
 * @param {string} options.prompt - Description of the video
 * @param {boolean} options.hasMedia - Whether post has media
 * @param {boolean} options.includeLex - Include Lex persona
 * @param {boolean} options.includeSantino - Include Santino persona
 * @returns {Promise<{combined: string, en: string, es: string}>}
 */
async function generateVideoDescription({ prompt, hasMedia = false, includeLex = false, includeSantino = false }) {
  const maxCharsPerLang = 500;
  const chatFn = module.exports.chat || chat;

  let lexInstruction = includeLex ? '- Include Lex hashtags (#LexPer #PNPtvLex)\n' : '';
  let santinoInstruction = includeSantino ? '- Include Santino hashtags (#Santino #MethDaddy #CultoSantino)\n' : '';

  // Generate English version
  const enPrompt = `Create a video description for: ${prompt}\n\nRequirements:\n- Language: English\n- TITLE in ALL CAPS (attention-grabbing)\n- Description: narrative, seductive, max 6 lines inviting to watch\n${lexInstruction}${santinoInstruction}- End with hashtags`;

  let enContent = await chatFn({
    mode: 'videoDescription',
    language: 'English',
    prompt: enPrompt,
    maxTokens: 250,
  });

  if (enContent.length > maxCharsPerLang) {
    enContent = enContent.substring(0, maxCharsPerLang - 3) + '...';
  }

  // Generate Spanish version
  const esPrompt = `Create a video description for: ${prompt}\n\nRequirements:\n- Language: Spanish\n- TITLE in ALL CAPS (attention-grabbing)\n- Description: narrative, seductive, max 6 lines inviting to watch\n${lexInstruction}${santinoInstruction}- End with hashtags`;

  let esContent = await chatFn({
    mode: 'videoDescription',
    language: 'Spanish',
    prompt: esPrompt,
    maxTokens: 250,
  });

  if (esContent.length > maxCharsPerLang) {
    esContent = esContent.substring(0, maxCharsPerLang - 3) + '...';
  }

  const combined = `🇬🇧 ENGLISH:\n${enContent}\n\n🇪🇸 ESPAÑOL:\n${esContent}`;

  logger.info('Generated video description', {
    enLength: enContent.length,
    esLength: esContent.length,
    combinedLength: combined.length
  });

  return { combined, en: enContent, es: esContent, english: enContent, spanish: esContent };
}

/**
 * Generate bilingual sales post content
 * @param {Object} options - Generation options
 * @param {string} options.prompt - Sales pitch details (product, price, benefits, etc.)
 * @param {boolean} options.hasMedia - Whether post has media
 * @param {boolean} options.includeLex - Include Lex persona
 * @param {boolean} options.includeSantino - Include Santino persona
 * @returns {Promise<{combined: string, en: string, es: string}>}
 */
async function generateSalesPost({ prompt, hasMedia = false, includeLex = false, includeSantino = false }) {
  const maxCharsPerLang = 500;
  const chatFn = module.exports.chat || chat;

  let lexInstruction = includeLex ? '- Include Lex hashtags (#LexPer #PNPtvLex)\n' : '';
  let santinoInstruction = includeSantino ? '- Include Santino hashtags (#Santino #MethDaddy #CultoSantino)\n' : '';

  // Generate English version
  const enPrompt = `Create a sales post for: ${prompt}\n\nRequirements:\n- Language: English\n- HOOK in ALL CAPS (scroll-stopping)\n- Include price and benefits clearly\n- CTA with approved link (t.me/pnplatinotv_bot?start=plans or pnptv.app)\n${lexInstruction}${santinoInstruction}- End with hashtags`;

  let enContent = await chatFn({
    mode: 'salesPost',
    language: 'English',
    prompt: enPrompt,
    maxTokens: 280,
  });

  if (enContent.length > maxCharsPerLang) {
    enContent = enContent.substring(0, maxCharsPerLang - 3) + '...';
  }

  // Generate Spanish version
  const esPrompt = `Create a sales post for: ${prompt}\n\nRequirements:\n- Language: Spanish\n- HOOK in ALL CAPS (scroll-stopping)\n- Include price and benefits clearly\n- CTA with approved link (t.me/pnplatinotv_bot?start=plans or pnptv.app)\n${lexInstruction}${santinoInstruction}- End with hashtags`;

  let esContent = await chatFn({
    mode: 'salesPost',
    language: 'Spanish',
    prompt: esPrompt,
    maxTokens: 280,
  });

  if (esContent.length > maxCharsPerLang) {
    esContent = esContent.substring(0, maxCharsPerLang - 3) + '...';
  }

  const combined = `🇬🇧 ENGLISH:\n${enContent}\n\n🇪🇸 ESPAÑOL:\n${esContent}`;

  logger.info('Generated sales post', {
    enLength: enContent.length,
    esLength: esContent.length,
    combinedLength: combined.length
  });

  return { combined, en: enContent, es: esContent, english: enContent, spanish: esContent };
}

module.exports = {
  chat,
  generateSharePost,
  generateVideoDescription,
  generateSalesPost,
};

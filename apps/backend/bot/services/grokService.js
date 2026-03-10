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
    xPost: { temperature: 0.7, defaultTokens: 450, mediaTokens: 450 },
    streamChat: { temperature: 0.85, defaultTokens: 800, mediaTokens: 800 },
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

  // ── UPDATED BRAND VOICE (Estrategias de Optimización Algorítmica 2026) ──────
  // Based on advanced Grok configuration strategy for pnptv.app subscription conversion on X.
  // Incorporates: algorithmic scoring matrix, algospeak, bilingual transcreation,
  // viral thread anatomy, CTA psychology, and X SEO optimization.

  const methDaddyPersona = `Eres el Director de Marketing Digital de pnptv.app y redactor de élite para X (Twitter). Hablas en primera persona como Santino, fundador y host de PNP Latino TV. Eres un especialista en crecimiento de audiencia en X, experto en la subcultura queer PNP y en las normativas y pesos algorítmicos de la plataforma en 2026.

IDENTIDAD Y PLATAFORMA:
pnptv.app es el hub #1 de la comunidad gay P&P (party & play). Plataforma privada solo para adultos (18+), con contenido real, personas reales.
- Nearby: encuentra guys cerca de ti
- Hangouts: salas de video privadas/públicas
- PNP Television Live: shows en vivo, streams 1:1 privados
- Videorama: playlists de contenido PNP curado
- Membresía PRIME: $24.99/mes | Member: $9.99/mes | Lifetime: pago único, acceso para siempre
- Landing de conversión: pnptv.app/join

URL APROBADA (SOLO ESTA):
- pnptv.app (paths permitidos: pnptv.app/join, pnptv.app/plans, pnptv.app/lifetime100)
- NUNCA uses otras URLs, dominios, o links de Telegram.

CONOCIMIENTO DEL DOMINIO — CULTURA P&P:
Comprendes profundamente los términos de la comunidad: "pnp", "zoom gay", "clouds", "rush", "slam", "P&P", "the lifestyle", "salas de aromas". Entiendes sus connotaciones culturales, el sentido de pertenencia que generan, y el riesgo algorítmico que implica usarlos de forma explícita. Por eso dominas el ALGOSPEAK.

DICCIONARIO DE ALGOSPEAK — SUSTITUCIONES AUTOMÁTICAS:
Aplica estas sustituciones cuando el contexto sea promocional o de alto riesgo algorítmico:
- PNP / Party and Play → "P&P", "The lifestyle", "Diversión nocturna", "clouds" ☁️☁️ 🧊🔥
- Slam / Injection → "S-lam", "Sesiones intensas", "Deep sessions" ⚡⚡
- Rush / Poppers → "Aromas", "Adrenalina", "Momentos rush" 🌬️✨
- Sex / Porn → "Seggs", "Contenido premium", "Corn" 🌽🍑
- Link externo → "Enlace en la respuesta", "Donde ya sabes" 🔗👇 ⛓️
- Zoom gay → "La sala", "El zoom", "Nuestra sesión" (en contextos de riesgo)
Alterna entre lenguaje directo y algospeak según si el post es informativo o puramente promocional.

ESTRATEGIA ALGORÍTMICA DE X 2026:
El algoritmo de X premia las interacciones por este orden de peso:
1. Repost (20x) — máxima difusión
2. Reply (13.5x) — retención en hilo
3. Bookmark (10x) — señal de valor duradero
4. Clic en perfil (5x) — intención de conversión
5. Like (1x) — señal básica
El contenido decae un 50% en visibilidad cada 6 horas. Por eso: GANCHO potente en los primeros segundos, posts cortos para generar reposts, y preguntas o afirmaciones audaces que provoquen replies.
Las cuentas Premium/Premium+ tienen multiplicadores de alcance de 2x-4x. La verificación actúa como sello de credibilidad ante la IA de clasificación.

REGLA CRÍTICA — LINKS EXTERNOS:
Los posts con links externos en el primer tweet pierden hasta el 90% de su alcance orgánico.
NUNCA incluyas pnptv.app en el PRIMER post de un hilo.
El link siempre va en el ÚLTIMO post del hilo o como primera respuesta al post principal.

ESTRATEGIA BILINGÜE — TRANSCREACIÓN:
No traduces literalmente. Realizas TRANSCREACIÓN: adaptas el mensaje emocional y la jerga de un idioma a otro manteniendo la intención original.
- En español: domina modismos neutros de España y Latinoamérica, cercanos pero sin exceso de street talk. Usa "papi", "parce", "chamo" con moderación.
- En inglés: jerga urbana LGBTQ+ auténtica (NYC/LA), directa, sin Spanglish a menos que se pida explícitamente.
- El 71% de la audiencia hispana navega fluidamente entre idiomas pero responde con mayor lealtad a marcas que demuestran sensibilidad cultural.

VENTANAS DE PUBLICACIÓN DE MÁXIMO IMPACTO (ET/CET):
- 09:00–11:00 AM: Hot take o noticia tendencia → captura scroll matutino, genera reposts
- 01:00–03:00 PM: Clip corto o infografía → clics en perfil durante almuerzo
- 06:00–08:00 PM: Hilo de valor/storytelling → máxima retención en ocio nocturno
- 10:00 PM–12:00 AM: CTA directo / promo → conversión en horas de alta afinidad adulta

TONO Y ESTILO:
- Directo, confiado, con pegada. Habla de beneficios reales: qué gana el usuario, por qué vale la pena.
- Sensualidad sugerida, no explícita. Insinúa, no exagera. Grounded en la realidad de la comunidad.
- Autenticidad lingüística: esto previene que el contenido sea ignorado como spam por Millennials y Gen Z (70% de la base de X).
- NO hashtags salvo que se soliciten explícitamente (reducen alcance orgánico en 2026).
- Emojis: extrema moderación, máximo 2-3 por post. Preferidos: 🔥 ☁️ ⚡ 🌬️ 👀 🔗
- CERO markdown: sin asteriscos, guiones bajos, backticks, headers ni bullet points con -. SOLO TEXTO PLANO.

SEO DE PERFIL — PALABRAS CLAVE CRÍTICAS:
pnp gay, zoom gay, clouds, slam, rush, P&P, the lifestyle, pnp community
Úsalas de forma natural en el contenido cuando el contexto lo permita.
Fórmula de bio optimizada: [Valor que ofreces] + [Prueba de autoridad] + URL

CTAs DE CONVERSIÓN — ROTA ENTRE ESTOS TIPOS:
- Basado en comunidad: "Únete a los [X] miembros que ya están en las nubes. Entra aquí."
- Basado en exclusividad: "Acceso instantáneo a la zona rush. Solo para invitados."
- Basado en curiosidad: "Mira lo que está pasando en el zoom gay de esta noche. No te quedes fuera."
- Click triggers (reduce ansiedad de conversión): añade frases como "Privacidad 100% garantizada" o "Sin cargos ocultos" debajo del link.
Los CTAs personalizados rinden un 202% mejor que "Regístrate" o "Haz clic aquí".

ENFOQUE EN BENEFICIOS REALES:
- Nearby para encontrar guys cerca
- Hangouts para conexiones en vivo
- Contenido exclusivo P&P
- Comunidad real, verificada, activa y global
- Deal de Lifetime: un solo pago, acceso para siempre
EVITA: fantasía excesiva, lenguaje explícito que active filtros, introducciones largas, palabras de relleno.`;

  const xPostBasePrompt = `Eres mi "doble digital" y redactor de élite para X (Twitter). Has internalizado el tono de voz de pnptv.app, su cultura P&P, su estrategia algorítmica 2026 y el uso preciso del algospeak. No estás aquí para conversar, estás aquí para producir contenido publicable de alto impacto que convierta impresiones en membresías.

TU OBJETIVO:
Tomar ideas en bruto y transformarlas en posts de X optimizados para el algoritmo de X 2026 — priorizando señales de alto peso (repost 20x, reply 13.5x, bookmark 10x) — mientras diriges tráfico cualificado a pnptv.app/join.

REGLAS DE ORO:

GANCHO ES DIOS: La primera línea detiene el scroll. Afirmación audaz, pregunta provocadora, dato sorprendente, o verdad incómoda de la comunidad. Nunca empieces con introducciones suaves.

BREVEDAD Y PEGADA: Frases cortas. Si puedes decirlo en 10 palabras, no uses 20. Saltos de línea dobles entre ideas. Cero bloques de texto densos.

SIN MARKDOWN: NUNCA asteriscos, guiones bajos, backticks, headers (#), ni bullet points (-). TEXTO PLANO. Énfasis con MAYÚSCULAS o emojis.

REGLA DE ORO DE LINKS: El link pnptv.app NUNCA va en el primer post. Siempre en el último post del hilo o como primera respuesta. El algoritmo penaliza links externos en el post inicial hasta en un 90%.

HASHTAGS: NO, salvo que se soliciten explícitamente.

ALGOSPEAK: Aplica sustituciones automáticas cuando el contexto sea promocional (P&P en lugar de PNP, "aromas" en lugar de rush, "S-lam" en contextos de riesgo, "enlace en la respuesta" en lugar de link externo).

ANATOMÍA DEL HILO VIRAL (cuando se pida un hilo de 10 posts):
Post 1 — EL GANCHO: Afirmación audaz o pregunta sobre soledad/comunidad/cultura P&P. NO incluir link. Diseñado para generar reposts y replies (señales de 20x y 13.5x).
Post 2 — LA CONFIGURACIÓN: Por qué pnptv es la respuesta. Introduce la plataforma y su propuesta de valor única.
Posts 3-8 — EL VALOR: Testimonios, funcionalidades, fragmentos de contenido, beneficios concretos. Cada post termina con un "gancho abierto" que invita a leer el siguiente.
Post 9 — EL RESUMEN: Beneficios clave en formato conciso: privacidad, comunidad global, contenido exclusivo.
Post 10 — EL CTA: Llamada a la acción con el link pnptv.app/join. Rota entre tipo Comunidad, Exclusividad o Curiosidad.

ESTRUCTURA DE CADA OPCIÓN DE POST INDIVIDUAL (MÁXIMO 250 CARACTERES):
1. GANCHO: Para el scroll (afirmación / pregunta / dato sorprendente)
2. DESARROLLO: Beneficio concreto (qué gana, qué resuelve, qué puede hacer)
3. CTA: Directo y orientado al beneficio (el link se añade automáticamente, NO lo escribas tú)

TU FLUJO:
Cuando recibas un tema o idea, no des explicaciones ni hagas preguntas. Entrega SOLO las 3 opciones listas para copiar y pegar.

OPCIÓN A (El Gancho Directo): Opinión fuerte o verdad incómoda → beneficio directo → CTA contundente (máx 250 chars, sin link)
OPCIÓN B (El Aportador de Valor): Promesa de valor útil → qué aprende/gana el usuario → CTA de descubrimiento (máx 250 chars, sin link)
OPCIÓN C (El Estilo Curiosidad): Intriga o pregunta retórica → curiosidad amplificada con beneficio real → CTA de acción (máx 250 chars, sin link)

OUTPUT EN EL IDIOMA SOLICITADO. Sin mezcla de idiomas. Transcreación cultural, no traducción literal.`;

  if (mode === 'broadcast') {
    return `${methDaddyPersona}\n\n${langHint}\n\nOUTPUT FORMAT FOR BROADCAST:\n- HOOK (ALL CAPS): 1 scroll-stopping line — afirmación audaz, pregunta provocadora, o dato sorprendente de la comunidad P&P\n- BODY: 2-3 frases con vibe P&P auténtico. Usa algospeak cuando el contexto lo requiera (☁️ P&P, aromas, S-lam). Sugiere, no exageres.\n- HASHTAGS: 2-3 hashtags relevantes (solo en broadcast, es el único modo donde van)\n\nRules:\n- Return ONLY the final formatted text (no labels)\n- ABSOLUTELY NO MARKDOWN: no asterisks, no underscores, no backticks, no # headers, no bullet dashes. PLAIN TEXT ONLY.\n- CRITICAL: Keep text UNDER 450 characters total\n- Separate sections with line breaks\n- Link NUNCA en broadcast (se pone como respuesta separada)`;
  }

  if (mode === 'sharePost') {
    return `${methDaddyPersona}\n\n${langHint}\n\nOUTPUT FORMAT FOR SHARE POST:\n- TITLE: 1 short, dominant engaging line\n- DESCRIPTION: 1-2 sentences max with PnP vibe\n- HASHTAGS: 2-4 relevant hashtags\n\nRules:\n- Return ONLY the final formatted text (no labels)\n- ABSOLUTELY NO MARKDOWN: no asterisks, no underscores, no backticks, no # headers, no bullet dashes. PLAIN TEXT ONLY.\n- CRITICAL: Keep text UNDER 450 characters total\n- Separate sections with line breaks\n- Hashtags: #PNPLatinoTV #MethDaddy #CultoSantino etc`;
  }

  if (mode === 'videoDescription') {
    return `${methDaddyPersona}\n\n${langHint}\n\nOUTPUT FORMAT FOR VIDEO DESCRIPTION:\n- TITLE: ALL CAPS, attention-grabbing (1 line)\n- DESCRIPTION: Narrative, descriptive text inviting people to watch the video. Maximum 6 lines. Paint a picture of what they'll see, tease the content, make them curious and horny to watch.\n- HASHTAGS: 3-5 relevant hashtags\n\nRules:\n- Return ONLY the final formatted text (no labels like "TITLE:" or "DESCRIPTION:")\n- ABSOLUTELY NO MARKDOWN: no asterisks, no underscores, no backticks, no # headers, no bullet dashes. PLAIN TEXT ONLY. Use ALL CAPS for emphasis instead.\n- Title must be in ALL CAPS\n- Description should be seductive, inviting, narrative style\n- Maximum 6 lines for description (not counting title and hashtags)\n- CRITICAL: Keep text UNDER 500 characters total\n- Separate title from description with blank line\n- End with hashtags`;
  }

  if (mode === 'salesPost') {
    return `${methDaddyPersona}\n\n${langHint}\n\nOUTPUT FORMAT FOR SALES POST:\n- HOOK (ALL CAPS): Para el scroll — verdad incómoda, promesa audaz, o dato de comunidad.\n- BODY: Pitch de ventas con oferta, precio, beneficios y urgencia. Usa algospeak si el contexto es de riesgo. Rota el tipo de CTA: comunidad ("Únete a los X miembros..."), exclusividad ("Acceso instantáneo..."), o curiosidad ("Mira lo que pasa esta noche...").\n- CLICK TRIGGER: Una frase corta bajo el link que reduce ansiedad ("Privacidad 100% garantizada" / "Sin cargos ocultos" / "Cancela cuando quieras")\n- CTA + LINK: pnptv.app/join (o pnptv.app/plans, pnptv.app/lifetime100)\n\nRules:\n- Return ONLY the final formatted text (no labels)\n- ABSOLUTELY NO MARKDOWN. PLAIN TEXT ONLY. Énfasis con MAYÚSCULAS.\n- Hook must be in ALL CAPS\n- Include price and benefits clearly\n- ONLY pnptv.app URLs. NO other links.\n- CRITICAL: Keep text UNDER 500 characters total\n- NO hashtags unless explicitly requested`;
  }

  if (mode === 'xPost') {
    return `${methDaddyPersona}\n\n${xPostBasePrompt}\n\n${langHint}\n\nOUTPUT RULES:\n\n⚠️ REGLA #1 — LÍMITE DE CARACTERES (NO NEGOCIABLE):\nCada opción debe tener MÁXIMO 250 CARACTERES de texto (sin contar el link). El link pnptv.app/join se añade automáticamente al final — NO lo incluyas tú. X tiene un límite estricto de 280 caracteres y el link ocupa 23 caracteres + 1 salto de línea = 24 caracteres reservados. Si tu texto supera 250 caracteres, el post se CORTARÁ y no se publicará completo. CUENTA LOS CARACTERES antes de generar cada opción. Prioriza BREVEDAD y PEGADA.\n\n- Genera EXACTAMENTE 3 opciones (A, B, C) como se describe arriba.\n- No agregues explicaciones ni texto extra, solo las 3 opciones.\n- MÁXIMO 250 CARACTERES por opción (texto solamente, sin el link). CUENTA CADA CARÁCTER.\n- NO incluyas links ni URLs en el texto. El link pnptv.app/join se añade automáticamente después.\n- Aplica algospeak automáticamente cuando el contexto sea promocional de alto riesgo.\n- Rota el tipo de CTA entre las 3 opciones: A=comunidad, B=exclusividad, C=curiosidad.\n- ABSOLUTAMENTE NADA DE MARKDOWN: no asteriscos (*), no guiones bajos (_), no backticks, no headers (#), no listas con guiones. SOLO TEXTO PLANO.\n- CRÍTICO: Write ALL post content EXCLUSIVELY in ${language}. ZERO language mixing. No Spanglish. Every single word must be in ${language} only. Slang and expressions must also be in ${language}.\n- IMPORTANT: Each option block must contain ONLY the tweet text itself. Do NOT include the option label (e.g. "OPCIÓN A", "OPTION A", "(El Gancho Directo)", etc.) inside the tweet body. The label goes on its own line as a header, then the tweet text follows.\n\nRECUERDA: 250 CARACTERES MÁXIMO por opción. Posts más largos serán cortados por el sistema.`;
  }

  if (mode === 'streamChat') {
    return `${methDaddyPersona}\n\n${langHint}\n\nOUTPUT FORMAT FOR STREAM CHAT MESSAGES:\nGenerate exactly 12 short chat messages for a live stream. These will be posted automatically in the stream chat every few minutes.\n\nRULES:\n- Each message MUST be under 150 characters\n- Make them fun, flirty, sexy, playful, and in the PNP community vibe\n- Encourage viewers to: send tips, book a private call, engage with the model\n- Reference the model's preferences naturally (what they like, their stream goal)\n- Mix English and Spanish naturally (Spanglish is OK for chat)\n- Use emojis sparingly (1-2 per message max)\n- NO markdown, NO hashtags, NO links\n- Vary the tone: some teasing, some encouraging, some playful questions\n- Output ONLY the 12 messages, one per line, numbered 1-12\n- PLAIN TEXT ONLY`;
  }

  return `${methDaddyPersona}\n\n${langHint}\n\nOutput rules:\n- Return ONLY the final message text in Meth Daddy style\n- ABSOLUTELY NO MARKDOWN: no asterisks, no underscores, no backticks, no # headers, no bullet dashes. PLAIN TEXT ONLY.\n- CRITICAL: Keep text UNDER 450 characters total\n- End with hashtags`;
}

/**
 * Strip markdown formatting from text for plain-text platforms like X.
 */
function stripMarkdown(text) {
  return text
    // Bold: **text** or __text__
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    // Italic: *text* or _text_ (but not inside words like don't)
    .replace(/(?<!\w)\*(.+?)\*(?!\w)/g, '$1')
    .replace(/(?<!\w)_(.+?)_(?!\w)/g, '$1')
    // Strikethrough: ~~text~~
    .replace(/~~(.+?)~~/g, '$1')
    // Inline code: `text`
    .replace(/`(.+?)`/g, '$1')
    // Headers: # text
    .replace(/^#{1,6}\s+/gm, '')
    // Bullet lists: - item or * item at line start
    .replace(/^[\s]*[-*]\s+/gm, '')
    // Numbered lists with dots: 1. item (but keep "1." in context)
    .replace(/^(\d+)\.\s+/gm, '$1) ');
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
    
    const cleaned = stripMarkdown(String(content).trim());
    logger.info('Grok API success', { contentLength: cleaned.length });
    return cleaned;
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

/**
 * Chat with Grok as a social media manager.
 * Receives a multi-turn messages array + live platform context string.
 */
async function chatWithGrokManager({ messages, contextBlock }) {
  const cfg = getGrokConfig();
  if (!cfg.apiKey) throw new Error('GROK_API_KEY not configured');

  const systemPrompt = `You are Grok, the social media strategist and growth manager for PNPtv (pnptv.app) — a private queer PNP community platform. You have deep expertise in X/Twitter marketing, viral content strategy, audience growth, and PNP community culture.

YOUR ROLE:
Analyze PNPtv's X campaign performance, platform demographics, and provide concrete, data-driven strategy recommendations. You can also create new campaigns, optimize existing ones, rewrite prompts, and identify growth opportunities.

PLATFORM CONTEXT (live data from the system):
${contextBlock || 'No data loaded yet.'}

CAPABILITIES:
- Analyze what campaigns are working vs failing, and why
- Suggest optimizations: better topics, custom prompts, schedule windows, language targeting
- Recommend new campaign ideas based on demographics and gaps
- Identify the best performing content angles and replicate them
- When asked to create a campaign, output the config as JSON like: {"action":"create_campaign","name":"...","accountHandle":"...","topic":"...","language":"es|en","activeHoursStart":14,"activeHoursEnd":23,"intervalMinutes":480,"customPrompt":"...","attachVideos":true}
- Include "attachVideos":true in the create_campaign JSON whenever video content would boost engagement (e.g. campaigns targeting adult content, previews, or high-visual topics). Set to false if text-only is more appropriate.
- When asked to add a random video or suggest adding video content to a campaign/post, output JSON like: {"action":"add_random_video","campaignId":"optional-campaign-id","reason":"short explanation of why video boosts engagement"}
- Explain X algorithm strategy with specific references to the data shown

TONE: Direct, strategic, CMO mindset. Give concrete recommendations with data reasoning. Be concise and actionable — no filler. Reference actual numbers from the context.

RULES:
- pnptv.app/login is the primary CTA URL — never recommend other URLs
- Available accounts: see context above
- When creating a campaign config, output valid JSON that can be parsed
- Keep responses under 400 words unless doing a full strategic analysis`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);

  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.6,
        max_tokens: 1200,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Grok API error ${res.status}: ${txt || res.statusText}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('Grok returned empty response');
    return String(content).trim();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Grok API request timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports.chatWithGrokManager = chatWithGrokManager;

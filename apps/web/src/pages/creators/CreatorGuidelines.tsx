import React, { useState } from "react";
import { Helmet } from "react-helmet-async";

interface Section {
  id: string;
  title: string;
  titleEs: string;
  icon: string;
  accent: string;
  items: { heading: string; headingEs: string; body: string; bodyEs: string }[];
}

const ACCESS_TYPES = [
  {
    label: "Free channel",
    labelEs: "Canal gratuito",
    who: "All registered members",
    whoEs: "Todos los miembros registrados",
    price: "No charge",
    priceEs: "Sin costo",
    bestFor: "Teasers, community posts, public announcements, profile intros",
    bestForEs: "Teasers, posts de comunidad, anuncios públicos, presentaciones de perfil",
    color: "#34A853",
  },
  {
    label: "Profile subscription channel",
    labelEs: "Canal de suscripción al perfil",
    who: "Fans subscribed to your profile",
    whoEs: "Fans suscritos a tu perfil",
    price: "Ice $5 · Crystal $10 · Diamond $15 / 30 days (you set your tier)",
    priceEs: "Ice $5 · Crystal $10 · Diamond $15 / 30 días (tú eliges tu nivel)",
    bestFor: "Regular exclusive content — your main subscriber feed",
    bestForEs: "Contenido exclusivo regular — tu feed principal de suscriptores",
    color: "#D4007A",
  },
  {
    label: "PRIME channel",
    labelEs: "Canal PRIME",
    who: "Platform PRIME subscribers (any plan)",
    whoEs: "Suscriptores PRIME de la plataforma (cualquier plan)",
    price: "Included in platform PRIME — you set channel to PRIME access",
    priceEs: "Incluido en el PRIME de la plataforma — tú configuras el acceso como PRIME",
    bestFor: "Cross-promotion content, platform-wide reach, featured placement",
    bestForEs: "Contenido de promoción cruzada, alcance en toda la plataforma, posicionamiento destacado",
    color: "#E69138",
  },
  {
    label: "Paid channel (30-day pass)",
    labelEs: "Canal de pago (pase de 30 días)",
    who: "Basic+ or PRIME users who purchase a per-channel pass",
    whoEs: "Usuarios Basic+ o PRIME que compran un pase por canal",
    price: "You set the price per channel (fans pay separately from their membership)",
    priceEs: "Tú fijas el precio por canal (los fans pagan por separado de su membresía)",
    bestFor: "Premium or niche content with a higher price barrier; fetish/specialty material",
    bestForEs: "Contenido premium o de nicho con mayor barrera de precio; material de especialidad/fetiche",
    color: "#9B59B6",
  },
  {
    label: "Paid hangout (group room)",
    labelEs: "Hangout de pago (sala grupal)",
    who: "Basic+ or PRIME users who purchase a 30-day room pass",
    whoEs: "Usuarios Basic+ o PRIME que compran un pase de sala de 30 días",
    price: "You set the price per hangout ($0.99 – $999.99)",
    priceEs: "Tú fijas el precio por hangout ($0.99 – $999.99)",
    bestFor: "Group events, watch parties, community calls, workshops",
    bestForEs: "Eventos grupales, watch parties, llamadas comunitarias, talleres",
    color: "#1A91DA",
  },
  {
    label: "Private call",
    labelEs: "Llamada privada",
    who: "Any member who purchases a call package",
    whoEs: "Cualquier miembro que compre un paquete de llamadas",
    price: "Fans buy time packages (e.g. 1 h / $25, 3 h / $60) from your profile",
    priceEs: "Los fans compran paquetes de tiempo (ej. 1 h / $25, 3 h / $60) desde tu perfil",
    bestFor: "1-on-1 personal sessions, fan interactions, private performances",
    bestForEs: "Sesiones personales 1-a-1, interacciones con fans, performances privadas",
    color: "#E74C3C",
  },
];

const SECTIONS: Section[] = [
  {
    id: "content",
    title: "Content Standards",
    titleEs: "Estándares de Contenido",
    icon: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z",
    accent: "#D4007A",
    items: [
      {
        heading: "Adults only",
        headingEs: "Solo adultos",
        body: "All content must exclusively feature individuals who are 18 years of age or older. This is a non-negotiable, legally binding requirement. Any content depicting minors in a sexual context results in immediate permanent ban and mandatory reporting to law enforcement.",
        bodyEs: "Todo el contenido debe incluir exclusivamente personas de 18 años o más. Este es un requisito legal innegociable. Cualquier contenido que muestre menores en contexto sexual resulta en baneo permanente inmediato y reporte obligatorio a las autoridades.",
      },
      {
        heading: "Consent documentation",
        headingEs: "Documentación de consentimiento",
        body: "All performers appearing in your content must have provided prior, documented consent. Keep signed consent records for every person featured in your uploads. PNPtv! may request these documents during a compliance review.",
        bodyEs: "Todos los performers que aparezcan en tu contenido deben haber dado consentimiento previo y documentado. Conserva registros de consentimiento firmados de cada persona. PNPtv! podrá solicitar estos documentos durante una revisión de cumplimiento.",
      },
      {
        heading: "No non-consensual depictions",
        headingEs: "Sin representaciones no consensuales",
        body: "Content that glorifies, simulates, or depicts sexual activity without all parties' consent — whether real or staged — is strictly prohibited and will be removed without notice.",
        bodyEs: "El contenido que glorifica, simula o representa actividad sexual sin el consentimiento de todas las partes — real o simulado — está estrictamente prohibido y será eliminado sin previo aviso.",
      },
      {
        heading: "Original content only",
        headingEs: "Solo contenido original",
        body: "You may only upload content that you own or have full rights to distribute. Uploading content belonging to another creator without their written permission violates our DMCA policy and will result in removal and possible account suspension.",
        bodyEs: "Solo puedes subir contenido que te pertenezca o para el que tengas derechos completos de distribución. Subir contenido de otro creador sin su permiso escrito viola nuestra política DMCA.",
      },
      {
        heading: "Prohibited content",
        headingEs: "Contenido prohibido",
        body: "The following is strictly forbidden: child sexual abuse material (CSAM), bestiality, content promoting violence against real persons, doxxing or sharing private information without consent, and any content illegal under applicable law.",
        bodyEs: "Lo siguiente está estrictamente prohibido: material de abuso sexual infantil (CSAM), zoofilia, contenido que promueva violencia contra personas reales, doxxing o compartir información privada sin consentimiento, y cualquier contenido ilegal.",
      },
    ],
  },
  {
    id: "strategy",
    title: "Content Strategy & Posting Guidelines",
    titleEs: "Estrategia de Contenido y Frecuencia",
    icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
    accent: "#E69138",
    items: [
      {
        heading: "New to creating? Start with a profile subscription",
        headingEs: "¿Eres nuevo creando? Empieza con una suscripción al perfil",
        body: "If you have no previous experience making content, start with a profile subscription (Ice tier, $5/mo). It's the lowest-barrier entry: one product, one price, no complex production. You build an audience, learn what resonates, and upgrade to Crystal or Diamond as your following grows. You can always add paid channels later — once you know what your community wants.",
        bodyEs: "Si no tienes experiencia previa creando contenido, empieza con una suscripción al perfil (nivel Ice, $5/mes). Es la entrada más accesible: un producto, un precio, sin producción compleja. Construyes una audiencia, aprendes qué conecta, y subes a Crystal o Diamond conforme crece tu comunidad. Siempre puedes agregar canales de pago después — una vez que sepas qué quiere tu comunidad.",
      },
      {
        heading: "Profile subscription: organic, personal, 5–8 minutes",
        headingEs: "Suscripción al perfil: orgánico, personal, 5–8 minutos",
        body: "Profile subscription content is meant to feel intimate and real. Aim for 5–8 minutes per video. Solo performances work perfectly here — no need for heavy editing, color grading, or multiple cameras. The rawer and more natural the better. This is where your subscribers get to know YOU: your personality, your vibe, what you're into. Think of it as your personal feed for fans who subscribe to you as a person.",
        bodyEs: "El contenido de suscripción al perfil debe sentirse íntimo y real. Apunta a 5–8 minutos por video. Las performances en solitario funcionan perfectamente aquí — sin necesidad de edición pesada, corrección de color ni múltiples cámaras. Mientras más crudo y natural, mejor. Aquí es donde tus suscriptores te conocen A TI: tu personalidad, tu vibra, lo que te gusta. Piénsalo como tu feed personal para fans que se suscriben a ti como persona.",
      },
      {
        heading: "Profile posting frequency: twice a week, minimum",
        headingEs: "Frecuencia de publicación en perfil: dos veces por semana, mínimo",
        body: "Post at least twice a week to keep subscribers engaged and justify their monthly fee. The more consistently you post, the stronger the case for a higher tier: Ice creators post 2×/week, Crystal creators aim for 3×/week, Diamond creators post 4+ times a week. Consistency matters more than perfection — a steady stream of authentic content outperforms sporadic high-production uploads.",
        bodyEs: "Publica al menos dos veces por semana para mantener a los suscriptores comprometidos y justificar su cuota mensual. Mientras más consistente seas, más justificado es un nivel más alto: creadores Ice publican 2×/semana, Crystal apuntan a 3×/semana, Diamond publican 4+ veces por semana. La consistencia importa más que la perfección — un flujo constante de contenido auténtico supera a las subidas esporádicas de alta producción.",
      },
      {
        heading: "Channels: 20 minutes minimum, once a week or every two weeks",
        headingEs: "Canales: mínimo 20 minutos, una vez por semana o cada dos semanas",
        body: "Channel content is a different product and should reflect that. Minimum 20 minutes per video. The production should be noticeably richer: multiple performers, thoughtful editing, scene structure, intros. Channels are where you bring subscribers into a curated experience — not just you being yourself, but a show with a concept. Post once a week at most; once every two weeks is perfectly acceptable for high-quality channel content. Quantity matters less here than quality and consistency of concept.",
        bodyEs: "El contenido de canal es un producto diferente y debe reflejarlo. Mínimo 20 minutos por video. La producción debe ser notablemente más rica: múltiples performers, edición cuidada, estructura de escenas, intros. Los canales son donde llevas a los suscriptores a una experiencia curada — no solo tú siendo tú mismo, sino un show con un concepto. Publica máximo una vez por semana; una vez cada dos semanas es perfectamente aceptable para contenido de canal de alta calidad. La cantidad importa menos que la calidad y consistencia del concepto.",
      },
      {
        heading: "Collaborations and fetish-themed channels",
        headingEs: "Colaboraciones y canales temáticos de fetiche",
        body: "We actively encourage creators to partner up and launch joint channels. Collaborative channels perform well because they combine audiences, share production effort, and create variety. Fetish-themed channels — built around a specific kink, scene, or aesthetic — are a great model for this: two or three creators who share the same interest can co-own a channel, cross-promote to their subscriber bases, and build a dedicated following that pays for the specialty content.",
        bodyEs: "Animamos activamente a los creadores a asociarse y lanzar canales conjuntos. Los canales colaborativos funcionan bien porque combinan audiencias, comparten el esfuerzo de producción y crean variedad. Los canales temáticos de fetiche — construidos alrededor de un kink, escena o estética específica — son un gran modelo para esto: dos o tres creadores que comparten el mismo interés pueden co-propietarios de un canal, hacer cross-promotion a sus bases de suscriptores y construir una audiencia dedicada.",
      },
      {
        heading: "Your profile is about who you are",
        headingEs: "Tu perfil trata de quién eres",
        body: "Use your profile and its subscription content to show the community who you are as a person — not just as a performer. What are you into? What's your scene? What do you enjoy outside of creating? The most successful creators on PNPtv! are ones whose subscribers feel like they actually know them. Authenticity builds loyalty, and loyalty drives renewals.",
        bodyEs: "Usa tu perfil y su contenido de suscripción para mostrarle a la comunidad quién eres como persona — no solo como performer. ¿Qué te gusta? ¿Cuál es tu escena? ¿Qué disfrutas fuera de crear? Los creadores más exitosos en PNPtv! son aquellos cuyos suscriptores sienten que realmente los conocen. La autenticidad construye lealtad, y la lealtad impulsa las renovaciones.",
      },
    ],
  },
  {
    id: "access",
    title: "Content & Access Types",
    titleEs: "Tipos de Contenido y Acceso",
    icon: "M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z",
    accent: "#1A91DA",
    items: [
      {
        heading: "Overview",
        headingEs: "Resumen",
        body: "PNPtv! gives you six distinct access layers for organizing your content. Choose the right one based on who you want to reach and how much you want to charge. All pricing is in USD; fans pay in any supported method (card, crypto).",
        bodyEs: "PNPtv! te ofrece seis capas de acceso distintas para organizar tu contenido. Elige la adecuada según a quién quieres llegar y cuánto quieres cobrar. Todos los precios son en USD; los fans pagan con cualquier método soportado (tarjeta, cripto).",
      },
      {
        heading: "Who can access what",
        headingEs: "Quién puede acceder a qué",
        body: "FREE accounts can view free channels and your public profile — but they cannot purchase subscriptions or paid content. They must upgrade to a Basic (pnp-member) plan first. PRIME users get into PRIME channels and all Basic content automatically; they still pay separately for paid channels, paid hangouts, creator subscriptions, and private calls.",
        bodyEs: "Las cuentas GRATUITAS pueden ver canales gratuitos y tu perfil público — pero no pueden comprar suscripciones ni contenido de pago. Primero deben subir a un plan Basic (pnp-member). Los usuarios PRIME acceden a canales PRIME y todo el contenido Basic automáticamente; aún pagan por separado los canales de pago, hangouts de pago, suscripciones a creadores y llamadas privadas.",
      },
      {
        heading: "Profile subscription vs. paid channel",
        headingEs: "Suscripción al perfil vs. canal de pago",
        body: "These are two separate products and can coexist. A profile subscription ($5/$10/$15/mo depending on your tier) gives the fan access to all your 'subscription' channels in one payment — think of it as your main fan club. A paid channel is an a-la-carte 30-day pass for a specific channel at a price you set. Use paid channels for specialty/niche content you want to price higher or keep separate from your general subscriber base.",
        bodyEs: "Estos son dos productos separados y pueden coexistir. Una suscripción al perfil ($5/$10/$15/mes según tu nivel) le da al fan acceso a todos tus canales de 'suscripción' en un solo pago — piénsalo como tu fan club principal. Un canal de pago es un pase de 30 días a la carta para un canal específico al precio que fijes. Usa canales de pago para contenido de especialidad o nicho que quieras cobrar más o mantener separado de tu base general de suscriptores.",
      },
      {
        heading: "Scoped access is standalone",
        headingEs: "El acceso por recurso es independiente",
        body: "If a fan buys a 30-day pass for a paid channel and their membership expires mid-period, they keep full access to that channel for their remaining days. Access tied to a specific resource (channel or hangout) survives membership changes — so fans can always trust that what they paid for won't disappear.",
        bodyEs: "Si un fan compra un pase de 30 días para un canal de pago y su membresía expira a mitad del período, mantiene acceso completo a ese canal por los días restantes. El acceso vinculado a un recurso específico (canal o hangout) sobrevive a los cambios de membresía — así los fans siempre pueden confiar en que lo que pagaron no desaparecerá.",
      },
      {
        heading: "No auto-renewal yet",
        headingEs: "Sin renovación automática por ahora",
        body: "All paid channels, hangouts, and creator profile subscriptions are sold as manual 30-day passes — there is no automatic billing yet. When the pass expires, fans must re-purchase. Make sure your content is worth coming back for, and remind subscribers before their access lapses. True recurring billing is on the roadmap.",
        bodyEs: "Todos los canales de pago, hangouts y suscripciones al perfil del creador se venden como pases manuales de 30 días — aún no hay facturación automática. Cuando el pase vence, los fans deben volver a comprar. Asegúrate de que tu contenido valga la pena regresar, y recuerda a los suscriptores antes de que su acceso expire. La facturación recurrente real está en la hoja de ruta.",
      },
    ],
  },
  {
    id: "community",
    title: "Community Standards",
    titleEs: "Estándares de Comunidad",
    icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
    accent: "#E69138",
    items: [
      {
        heading: "Respect and inclusion",
        headingEs: "Respeto e inclusión",
        body: "PNPtv! is a queer-first community. Discrimination, hate speech, or harassment based on race, ethnicity, gender identity, sexual orientation, HIV status, disability, or religion will not be tolerated and will result in immediate suspension.",
        bodyEs: "PNPtv! es una comunidad queer-first. La discriminación, el discurso de odio o el acoso por raza, etnia, identidad de género, orientación sexual, estatus VIH, discapacidad o religión no será tolerado.",
      },
      {
        heading: "No harassment or bullying",
        headingEs: "Sin acoso ni bullying",
        body: "Do not target, threaten, or demean other creators or members — either on the platform or through linked social accounts. Screenshots used to publicly shame members are also prohibited.",
        bodyEs: "No ataques, amenaces ni humilles a otros creadores o miembros — ni en la plataforma ni a través de cuentas sociales vinculadas. Las capturas de pantalla usadas para avergonzar públicamente a miembros también están prohibidas.",
      },
      {
        heading: "Privacy of others",
        headingEs: "Privacidad de otros",
        body: "Never share the personal information (real name, location, contacts, HIV status) of another member without their explicit consent. PNPtv! is a safe space — treat others' privacy as you'd want yours treated.",
        bodyEs: "Nunca compartas la información personal (nombre real, ubicación, contactos, estatus VIH) de otro miembro sin su consentimiento explícito. PNPtv! es un espacio seguro — trata la privacidad de otros como quisieras que traten la tuya.",
      },
      {
        heading: "Authentic representation",
        headingEs: "Representación auténtica",
        body: "Do not impersonate other creators, public figures, or PNPtv! staff. Your profile, avatar, and display name must accurately represent you. Fake or misleading profile information is grounds for removal.",
        bodyEs: "No te hagas pasar por otros creadores, figuras públicas o personal de PNPtv!. Tu perfil, avatar y nombre deben representarte con precisión. La información falsa o engañosa es motivo de eliminación.",
      },
    ],
  },
  {
    id: "legal",
    title: "Legal & Compliance",
    titleEs: "Legal y Cumplimiento",
    icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
    accent: "#34A853",
    items: [
      {
        heading: "2257 compliance (US performers)",
        headingEs: "Cumplimiento 2257 (performers en EE.UU.)",
        body: "If you or any performer in your content is a US resident or citizen, you must maintain 18 U.S.C. § 2257 records: a copy of valid government-issued photo ID, the performer's legal name, date of birth, and all aliases. These must be retained for 7 years and made available upon request.",
        bodyEs: "Si tú o algún performer en tu contenido es residente o ciudadano de EE.UU., debes mantener registros según 18 U.S.C. § 2257: copia de identificación oficial con foto, nombre legal del performer, fecha de nacimiento y todos los alias. Deben conservarse 7 años.",
      },
      {
        heading: "Age verification",
        headingEs: "Verificación de edad",
        body: "PNPtv! may require you to submit age verification documents for yourself and your on-screen performers at any time. Failure to provide these within 7 days of a request results in content removal and possible account suspension.",
        bodyEs: "PNPtv! podrá solicitarte documentos de verificación de edad para ti y tus performers en cualquier momento. La falta de entrega en 7 días resulta en eliminación de contenido y posible suspensión de cuenta.",
      },
      {
        heading: "Tax responsibility",
        headingEs: "Responsabilidad fiscal",
        body: "You are solely responsible for declaring and paying any taxes applicable to your creator earnings in your jurisdiction. PNPtv! does not withhold taxes on your behalf. Consult a tax professional if you are unsure of your obligations.",
        bodyEs: "Eres el único responsable de declarar y pagar los impuestos aplicables a tus ingresos como creador en tu jurisdicción. PNPtv! no retiene impuestos. Consulta a un profesional fiscal si tienes dudas.",
      },
      {
        heading: "DMCA & intellectual property",
        headingEs: "DMCA y propiedad intelectual",
        body: "Respect copyright. You may not include music, footage, or visuals you do not own without proper licensing. DMCA takedown notices received against your content are processed within 48 hours; repeat violations result in permanent removal.",
        bodyEs: "Respeta los derechos de autor. No puedes incluir música, imágenes o video que no sean tuyos sin licencia. Las notificaciones DMCA contra tu contenido se procesan en 48 horas; las violaciones repetidas resultan en eliminación permanente.",
      },
    ],
  },
  {
    id: "monetization",
    title: "Monetization & Payouts",
    titleEs: "Monetización y Pagos",
    icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    accent: "#9B59B6",
    items: [
      {
        heading: "Revenue split",
        headingEs: "División de ingresos",
        body: "PNPtv! operates a 70% creator / 30% platform commission on all monetized content and subscriptions. This split applies to channel subscriptions, call packages, scoped content purchases, and tips. No hidden fees.",
        bodyEs: "PNPtv! opera con una comisión del 70% creador / 30% plataforma en todo el contenido monetizado y suscripciones. Esta división aplica a suscripciones de canal, paquetes de llamadas, compras de contenido y propinas. Sin comisiones ocultas.",
      },
      {
        heading: "72-hour earnings hold",
        headingEs: "Retención de 72 horas",
        body: "All earnings are held for 72 hours after the transaction is completed. This window exists to process member refund requests. After the hold period, funds become available for withdrawal.",
        bodyEs: "Todas las ganancias se retienen 72 horas después de completarse la transacción. Esta ventana existe para procesar solicitudes de reembolso de miembros. Después del período de retención, los fondos están disponibles para retiro.",
      },
      {
        heading: "Refund policy",
        headingEs: "Política de reembolsos",
        body: "Members may request a refund within 24 hours of a purchase for technical failures. Chargebacks initiated without contacting support first will result in a negative balance and possible account suspension. Earnings held back for chargeback processing may take up to 30 days to resolve.",
        bodyEs: "Los miembros pueden solicitar reembolso dentro de las 24 horas de una compra por fallas técnicas. Los contracargos iniciados sin contactar soporte primero resultarán en saldo negativo y posible suspensión. Los fondos retenidos por contracargos pueden tardar hasta 30 días en resolverse.",
      },
      {
        heading: "Prohibited promotion tactics",
        headingEs: "Tácticas de promoción prohibidas",
        body: "Spam, fake engagement, coordinated review manipulation, and purchasing followers or subscribers are all prohibited. Engaging in these tactics voids your earnings and may result in permanent removal.",
        bodyEs: "El spam, el engagement falso, la manipulación coordinada de reseñas y la compra de seguidores o suscriptores están prohibidos. Incurrir en estas tácticas anula tus ganancias y puede resultar en eliminación permanente.",
      },
    ],
  },
  {
    id: "technical",
    title: "Technical Standards",
    titleEs: "Estándares Técnicos",
    icon: "M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18",
    accent: "#1A91DA",
    items: [
      {
        heading: "Video upload specs",
        headingEs: "Especificaciones de video",
        body: "Recommended: 1080p or higher, MP4 (H.264) or MOV format, 30–60 fps. Minimum accepted: 720p. Maximum file size: 4 GB per upload. Videos failing quality checks may be returned for re-encoding.",
        bodyEs: "Recomendado: 1080p o superior, formato MP4 (H.264) o MOV, 30–60 fps. Mínimo aceptado: 720p. Tamaño máximo por archivo: 4 GB. Los videos que no pasen el control de calidad podrán ser devueltos para re-codificación.",
      },
      {
        heading: "Live streaming",
        headingEs: "Transmisión en vivo",
        body: "PNPtv! uses RTMP for live streaming. Your stream key and server URL are in Go Live → Stream Settings. Recommended bitrate: 3,000–6,000 kbps. Streams idle for more than 30 minutes without viewers are automatically ended.",
        bodyEs: "PNPtv! usa RTMP para transmisión en vivo. Tu clave de stream y URL del servidor están en Ir en Vivo → Configuración de Stream. Bitrate recomendado: 3,000–6,000 kbps. Los streams inactivos por más de 30 minutos sin espectadores se terminan automáticamente.",
      },
      {
        heading: "Thumbnails",
        headingEs: "Miniaturas",
        body: "Upload a custom thumbnail for every video. Accepted formats: JPG, PNG, WebP. Recommended size: 1280×720 px. Thumbnails must accurately represent the content — misleading thumbnails are removed.",
        bodyEs: "Sube una miniatura personalizada para cada video. Formatos aceptados: JPG, PNG, WebP. Tamaño recomendado: 1280×720 px. Las miniaturas deben representar fielmente el contenido — las miniaturas engañosas serán eliminadas.",
      },
      {
        heading: "Account security",
        headingEs: "Seguridad de cuenta",
        body: "You are responsible for all activity under your creator account. Enable a strong passkey or password and never share your credentials. If you suspect unauthorized access, contact support immediately at support@pnptv.app.",
        bodyEs: "Eres responsable de toda la actividad bajo tu cuenta de creador. Habilita una passkey o contraseña segura y nunca compartas tus credenciales. Si sospechas acceso no autorizado, contacta soporte inmediatamente en support@pnptv.app.",
      },
    ],
  },
  {
    id: "safety",
    title: "Harm Reduction & Safety",
    titleEs: "Reducción de Daños y Seguridad",
    icon: "M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z",
    accent: "#E74C3C",
    items: [
      {
        heading: "PNP harm reduction",
        headingEs: "Reducción de daños PNP",
        body: "PNPtv! is built by and for the PNP community. We encourage creators to promote safer use practices where relevant: fentanyl test strips, naloxone access, starting with lower doses, not using alone, and knowing your limits. This is a community that looks out for each other.",
        bodyEs: "PNPtv! está construida por y para la comunidad PNP. Animamos a los creadores a promover prácticas de uso más seguras cuando sea relevante: tiras de prueba de fentanilo, acceso a naloxona, comenzar con dosis más bajas, no usar en solitario y conocer tus límites.",
      },
      {
        heading: "HIV & sexual health",
        headingEs: "VIH y salud sexual",
        body: "We support open, stigma-free conversation about HIV status, PrEP, PEP, and sexual health. Creators are encouraged — not required — to share their own practices and frame content in a sex-positive, health-informed way.",
        bodyEs: "Apoyamos las conversaciones abiertas y sin estigma sobre el estatus VIH, PrEP, PEP y la salud sexual. Se alienta a los creadores — pero no se les exige — a compartir sus propias prácticas y enmarcar el contenido de manera sex-positive e informada.",
      },
      {
        heading: "Mental health",
        headingEs: "Salud mental",
        body: "Creating content full-time can be emotionally demanding. PNPtv! staff is available to talk — reach us at support@pnptv.app. If you or a viewer is in crisis, direct them to the Trevor Project (1-866-488-7386) or Trans Lifeline (877-565-8860).",
        bodyEs: "Crear contenido a tiempo completo puede ser emocionalmente exigente. El equipo de PNPtv! está disponible para hablar — escríbenos a support@pnptv.app. Si tú o un espectador está en crisis, dirige a la persona al Trevor Project (1-866-488-7386) o Trans Lifeline (877-565-8860).",
      },
      {
        heading: "Report abuse",
        headingEs: "Reportar abuso",
        body: "If you encounter content or behavior that violates these guidelines — from other creators or members — report it immediately via the in-app report button or by emailing abuse@pnptv.app. All reports are reviewed within 24 hours.",
        bodyEs: "Si encuentras contenido o comportamiento que viole estas guías — de otros creadores o miembros — repórtalo inmediatamente usando el botón de reporte en la app o escribiendo a abuse@pnptv.app. Todos los reportes se revisan en 24 horas.",
      },
    ],
  },
];

export default function CreatorGuidelines() {
  const [lang, setLang] = useState<"en" | "es">(() => {
    try {
      return (localStorage.getItem("pnp_lang") as "en" | "es") || "en";
    } catch {
      return "en";
    }
  });
  const [openSection, setOpenSection] = useState<string | null>("content");
  const es = lang === "es";

  return (
    <>
      <Helmet>
        <title>Guidelines — Creator Studio — PNPtv!</title>
      </Helmet>

      <div className="max-w-3xl mx-auto pb-12">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-pnp-textPrimary">
              {es ? "Guías para Creadores" : "Creator Guidelines"}
            </h1>
            <p className="text-sm text-pnp-textSecondary mt-1">
              {es
                ? "Lee y sigue estas guías para mantener tu cuenta activa y en buen estado."
                : "Read and follow these guidelines to keep your account active and in good standing."}
            </p>
          </div>
          <button
            onClick={() => setLang(l => l === "en" ? "es" : "en")}
            className="flex-shrink-0 ml-4 px-3 py-1.5 rounded-lg text-xs font-semibold border border-white/10 bg-white/5 hover:bg-white/10 text-pnp-textSecondary transition-colors"
          >
            {es ? "English" : "Español"}
          </button>
        </div>

        {/* Last updated banner */}
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.07] mb-6 text-xs text-pnp-textSecondary">
          <svg className="w-4 h-4 flex-shrink-0 text-pnp-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>
            {es
              ? "Actualizado el 21 de junio de 2026 · Consulta a support@pnptv.app si tienes preguntas."
              : "Updated June 21, 2026 · Reach out to support@pnptv.app with any questions."}
          </span>
        </div>

        {/* Accordion sections */}
        <div className="space-y-2">
          {SECTIONS.map((section) => {
            const isOpen = openSection === section.id;
            return (
              <div
                key={section.id}
                className="rounded-xl border overflow-hidden transition-colors"
                style={{
                  borderColor: isOpen ? `${section.accent}40` : "rgba(255,255,255,0.07)",
                  background: isOpen ? `${section.accent}08` : "rgba(255,255,255,0.02)",
                }}
              >
                <button
                  onClick={() => setOpenSection(isOpen ? null : section.id)}
                  className="w-full flex items-center gap-3 px-4 py-4 text-left"
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: `${section.accent}20` }}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: section.accent }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={section.icon} />
                    </svg>
                  </div>
                  <span className="flex-1 text-sm font-semibold text-pnp-textPrimary">
                    {es ? section.titleEs : section.title}
                  </span>
                  <svg
                    className="w-4 h-4 text-pnp-textSecondary transition-transform flex-shrink-0"
                    style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 space-y-4">
                    <div className="h-px bg-white/[0.06]" />

                    {/* Access types section gets the comparison cards first, then the text items */}
                    {section.id === "access" && (
                      <div className="space-y-2 mb-2">
                        {ACCESS_TYPES.map((at, i) => (
                          <div
                            key={i}
                            className="rounded-lg border p-3"
                            style={{ borderColor: `${at.color}30`, background: `${at.color}08` }}
                          >
                            <div className="flex items-center gap-2 mb-2">
                              <span
                                className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                                style={{ background: `${at.color}25`, color: at.color }}
                              >
                                {es ? at.labelEs : at.label}
                              </span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 text-[11px]">
                              <div>
                                <span className="text-pnp-textSecondary/60 uppercase tracking-wider font-semibold text-[9px]">
                                  {es ? "Quién accede" : "Who can access"}
                                </span>
                                <p className="text-pnp-textSecondary mt-0.5">{es ? at.whoEs : at.who}</p>
                              </div>
                              <div>
                                <span className="text-pnp-textSecondary/60 uppercase tracking-wider font-semibold text-[9px]">
                                  {es ? "Precio" : "Price"}
                                </span>
                                <p className="text-pnp-textSecondary mt-0.5">{es ? at.priceEs : at.price}</p>
                              </div>
                              <div>
                                <span className="text-pnp-textSecondary/60 uppercase tracking-wider font-semibold text-[9px]">
                                  {es ? "Mejor para" : "Best for"}
                                </span>
                                <p className="text-pnp-textSecondary mt-0.5">{es ? at.bestForEs : at.bestFor}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {section.items.map((item, i) => (
                      <div key={i}>
                        <h3 className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: section.accent }}>
                          {es ? item.headingEs : item.heading}
                        </h3>
                        <p className="text-sm text-pnp-textSecondary leading-relaxed">
                          {es ? item.bodyEs : item.body}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer CTA */}
        <div className="mt-8 p-5 rounded-xl border border-pnp-accent/20 bg-pnp-accent/5 text-center">
          <p className="text-sm font-semibold text-pnp-textPrimary mb-1">
            {es ? "¿Tienes preguntas sobre estas guías?" : "Have questions about these guidelines?"}
          </p>
          <p className="text-xs text-pnp-textSecondary mb-3">
            {es
              ? "Nuestro equipo está disponible para ayudarte."
              : "Our team is available to help."}
          </p>
          <a
            href="mailto:support@pnptv.app"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white transition-all hover:brightness-110"
            style={{ background: "linear-gradient(135deg, #D4007A, #E69138)" }}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            support@pnptv.app
          </a>
        </div>
      </div>
    </>
  );
}

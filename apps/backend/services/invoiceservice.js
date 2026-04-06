const PDFDocument = require('pdfkit');

class InvoiceService {
  /**
   * Generate a branded PDF invoice and return it as a Buffer.
   * @param {Object} opts
   * @param {string} opts.invoiceNumber - Unique invoice/reference ID
   * @param {string} opts.customerName - Customer display name
   * @param {string} opts.planName - Plan display name
   * @param {number} opts.amount - Amount in USD
   * @param {string} [opts.currency='USD'] - Currency code
   * @param {string} [opts.provider='epayco'] - Payment provider
   * @param {string} [opts.transactionId] - Provider transaction ID
   * @param {Date}   [opts.purchaseDate] - Purchase date (defaults to now)
   * @param {Date}   [opts.expiryDate] - Subscription expiry date
   * @param {string} [opts.language='es'] - 'es' or 'en'
   * @returns {Promise<{ id: string, buffer: Buffer }>}
   */
  static async generateInvoice({
    invoiceNumber,
    customerName,
    planName,
    amount,
    currency = 'USD',
    provider = 'epayco',
    transactionId,
    purchaseDate,
    expiryDate,
    language = 'es',
  }) {
    const id = invoiceNumber || `INV-${Date.now()}`;
    const date = purchaseDate || new Date();
    const isEs = language === 'es';

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));

    const done = new Promise((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    // ── Brand colors ──
    const ACCENT = '#D4007A';
    const DARK = '#1C1C1E';
    const GRAY = '#666666';
    const LIGHT_BG = '#F8F9FA';

    // ── Header bar ──
    doc.rect(0, 0, doc.page.width, 80).fill(DARK);
    doc.fontSize(28).fill('#FFFFFF').text('PNPtv', 50, 25, { continued: true });
    doc.fontSize(12).fill(ACCENT).text('!', { continued: false });
    doc.fontSize(10).fill('#AAAAAA').text(
      isEs ? 'Factura de Compra' : 'Purchase Invoice',
      0, 45, { align: 'right', width: doc.page.width - 50 }
    );

    // ── Invoice meta ──
    let y = 110;
    doc.fontSize(10).fill(GRAY);
    doc.text(`${isEs ? 'Factura' : 'Invoice'}: ${id}`, 50, y);
    doc.text(
      `${isEs ? 'Fecha' : 'Date'}: ${date.toLocaleDateString(isEs ? 'es-ES' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
      0, y, { align: 'right', width: doc.page.width - 50 }
    );

    // ── Divider ──
    y += 30;
    doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor(ACCENT).lineWidth(2).stroke();

    // ── Bill To ──
    y += 20;
    doc.fontSize(11).fill(ACCENT).text(isEs ? 'FACTURADO A' : 'BILL TO', 50, y);
    y += 18;
    doc.fontSize(12).fill(DARK).text(customerName || (isEs ? 'Cliente' : 'Customer'), 50, y);

    // ── Items table ──
    y += 40;
    // Header row
    doc.rect(50, y, doc.page.width - 100, 28).fill(DARK);
    doc.fontSize(10).fill('#FFFFFF');
    doc.text(isEs ? 'DESCRIPCIÓN' : 'DESCRIPTION', 60, y + 8, { width: 250 });
    doc.text(isEs ? 'PROVEEDOR' : 'PROVIDER', 320, y + 8, { width: 100 });
    doc.text(isEs ? 'MONTO' : 'AMOUNT', 430, y + 8, { width: 100, align: 'right' });

    // Item row
    y += 28;
    doc.rect(50, y, doc.page.width - 100, 32).fill(LIGHT_BG);
    doc.fontSize(10).fill(DARK);
    doc.text(planName || 'Subscription', 60, y + 10, { width: 250 });
    doc.fill(GRAY).text(provider === 'daimo' ? 'Daimo Pay' : 'ePayco', 320, y + 10, { width: 100 });
    doc.fill(DARK).text(
      `$${(parseFloat(amount) || 0).toFixed(2)} ${currency}`,
      430, y + 10, { width: 100, align: 'right' }
    );

    // Total row
    y += 32;
    doc.rect(50, y, doc.page.width - 100, 32).fill(ACCENT);
    doc.fontSize(11).fill('#FFFFFF');
    doc.text('TOTAL', 60, y + 9, { width: 250 });
    doc.text(
      `$${(parseFloat(amount) || 0).toFixed(2)} ${currency}`,
      430, y + 9, { width: 100, align: 'right' }
    );

    // ── Payment details ──
    y += 55;
    doc.fontSize(11).fill(ACCENT).text(isEs ? 'DETALLES DEL PAGO' : 'PAYMENT DETAILS', 50, y);
    y += 20;
    doc.fontSize(10).fill(GRAY);

    const details = [
      [isEs ? 'ID de Transacción' : 'Transaction ID', transactionId || id],
      [isEs ? 'Método de Pago' : 'Payment Method', provider === 'daimo' ? 'Daimo Pay (Crypto/Apps)' : 'ePayco (Card/PSE)'],
      [isEs ? 'Estado' : 'Status', isEs ? 'Completado' : 'Completed'],
    ];

    if (expiryDate) {
      const expLabel = isEs ? 'Válido hasta' : 'Valid until';
      const expValue = new Date(expiryDate).toLocaleDateString(isEs ? 'es-ES' : 'en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      });
      details.push([expLabel, expValue]);
    }

    for (const [label, value] of details) {
      doc.fill(GRAY).text(`${label}:`, 60, y, { continued: true, width: 180 });
      doc.fill(DARK).text(`  ${value}`, { continued: false });
      y += 18;
    }

    // ── Footer ──
    y = doc.page.height - 80;
    doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor('#DDDDDD').lineWidth(0.5).stroke();
    y += 12;
    doc.fontSize(8).fill(GRAY);
    doc.text('PNPtv! | billing@pnptv.app | https://pnptv.app', 50, y, {
      align: 'center',
      width: doc.page.width - 100,
    });
    doc.text(
      isEs
        ? 'Este documento es una confirmación de pago. No es una factura fiscal.'
        : 'This document is a payment confirmation. It is not a tax invoice.',
      50, y + 14, { align: 'center', width: doc.page.width - 100 }
    );

    doc.end();
    const buffer = await done;
    return { id, buffer };
  }

  /**
   * Generate a branded "How to Use PNPtv" PDF onboarding guide.
   * @param {Object} opts
   * @param {string} [opts.customerName] - Customer display name
   * @param {string} [opts.planName] - Plan display name
   * @param {string} [opts.language='es'] - 'es' or 'en'
   * @returns {Promise<{ buffer: Buffer }>}
   */
  static async generateOnboardingGuide({ customerName, planName, language = 'es' }) {
    const isEs = language === 'es';
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));

    const done = new Promise((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    // ── Brand colors ──
    const ACCENT = '#D4007A';
    const DARK = '#1C1C1E';
    const GRAY = '#666666';
    const LIGHT_BG = '#F8F9FA';
    const WHITE = '#FFFFFF';
    const pageW = doc.page.width;
    const contentW = pageW - 100;

    // ═══════════════════════════════════════════════
    // PAGE 1 — Cover + Welcome
    // ═══════════════════════════════════════════════

    // Header bar
    doc.rect(0, 0, pageW, 80).fill(DARK);
    doc.fontSize(28).fill(WHITE).text('PNPtv', 50, 25, { continued: true });
    doc.fontSize(12).fill(ACCENT).text('!', { continued: false });
    doc.fontSize(10).fill('#AAAAAA').text(
      isEs ? 'Guia de Uso' : 'User Guide',
      0, 45, { align: 'right', width: pageW - 50 }
    );

    // Welcome section
    let y = 120;
    doc.fontSize(24).fill(ACCENT).text(
      isEs ? 'Bienvenido a PNPtv!' : 'Welcome to PNPtv!',
      50, y, { align: 'center', width: contentW }
    );

    y += 40;
    doc.fontSize(12).fill(DARK).text(
      isEs
        ? `Hola ${customerName || 'miembro'},`
        : `Hello ${customerName || 'member'},`,
      50, y
    );

    y += 25;
    doc.fontSize(11).fill(GRAY).text(
      isEs
        ? `Gracias por suscribirte a ${planName || 'PNPtv'}. Tu membresia esta activa y tienes acceso completo a todas las funciones de la plataforma.`
        : `Thank you for subscribing to ${planName || 'PNPtv'}. Your membership is active and you have full access to all platform features.`,
      50, y, { width: contentW, lineGap: 4 }
    );

    y += 55;
    doc.fontSize(11).fill(ACCENT).text(
      isEs ? 'ACCEDE A PNPTV' : 'ACCESS PNPTV',
      50, y
    );
    y += 20;
    doc.fontSize(11).fill(DARK).text('https://pnptv.app', 50, y);
    y += 15;
    doc.fontSize(10).fill(GRAY).text(
      isEs
        ? 'Tambien puedes acceder desde Telegram buscando @PNPtvBot'
        : 'You can also access via Telegram by searching @PNPtvBot',
      50, y
    );

    // Divider
    y += 35;
    doc.moveTo(50, y).lineTo(pageW - 50, y).strokeColor(ACCENT).lineWidth(2).stroke();

    // Features overview title
    y += 20;
    doc.fontSize(16).fill(DARK).text(
      isEs ? 'Funciones Disponibles' : 'Available Features',
      50, y, { align: 'center', width: contentW }
    );

    // Feature list (page 1 — first 4 features)
    const features = isEs ? [
      {
        icon: '📺',
        title: 'Videorama',
        desc: 'Biblioteca de videos, musica y podcasts. Navega por categorias, crea tus propias listas de reproduccion y disfruta de contenido exclusivo en streaming.',
      },
      {
        icon: '📹',
        title: 'Hangouts',
        desc: 'Salas de videollamadas comunitarias. Crea o unete a grupos publicos y privados, comparte multimedia y haz videollamadas con otros miembros.',
      },
      {
        icon: '🔴',
        title: 'PNP Television Live',
        desc: 'Transmisiones en vivo y grabaciones exclusivas. Mira shows en tiempo real, envia propinas a los performers y accede a las repeticiones.',
      },
      {
        icon: '💬',
        title: 'Social Feed',
        desc: 'Publica contenido, da likes, reposts y comenta. Conecta con la comunidad y comparte tus momentos. Tambien puedes hacer crosspost a Bluesky.',
      },
    ] : [
      {
        icon: '📺',
        title: 'Videorama',
        desc: 'Video, music, and podcast library. Browse by category, create your own playlists, and enjoy exclusive streaming content.',
      },
      {
        icon: '📹',
        title: 'Hangouts',
        desc: 'Community video call rooms. Create or join public and private groups, share media, and make video calls with other members.',
      },
      {
        icon: '🔴',
        title: 'PNP Television Live',
        desc: 'Live streams and exclusive recordings. Watch shows in real time, send tips to performers, and access replays.',
      },
      {
        icon: '💬',
        title: 'Social Feed',
        desc: 'Post content, like, repost, and comment. Connect with the community and share your moments. You can also crosspost to Bluesky.',
      },
    ];

    y += 30;
    for (const feat of features) {
      if (y > 700) break; // safety: don't overflow page
      doc.rect(50, y, contentW, 60).fill(LIGHT_BG);
      doc.fontSize(12).fill(DARK).text(`${feat.icon}  ${feat.title}`, 65, y + 8, { width: contentW - 30 });
      doc.fontSize(9).fill(GRAY).text(feat.desc, 65, y + 26, { width: contentW - 30, lineGap: 2 });
      y += 68;
    }

    // ═══════════════════════════════════════════════
    // PAGE 2 — More features
    // ═══════════════════════════════════════════════
    doc.addPage();

    // Header bar
    doc.rect(0, 0, pageW, 60).fill(DARK);
    doc.fontSize(20).fill(WHITE).text('PNPtv', 50, 18, { continued: true });
    doc.fontSize(10).fill(ACCENT).text('!', { continued: true });
    doc.fill('#AAAAAA').text(
      isEs ? '  — Guia de Uso (continuacion)' : '  — User Guide (continued)',
      { continued: false }
    );

    y = 85;
    const features2 = isEs ? [
      {
        icon: '📍',
        title: 'Nearby (Quien Esta Cerca)',
        desc: 'Descubre miembros y lugares cerca de ti usando geolocalizacion. Activa tu ubicacion en Perfil > Ubicacion para aparecer en el mapa y ver a otros miembros cercanos.',
      },
      {
        icon: '✉️',
        title: 'Chat y Mensajes Directos',
        desc: 'Chatea en salas de grupo dentro de los Hangouts o envia mensajes directos privados a cualquier miembro. Soporta texto, imagenes y videos.',
      },
      {
        icon: '👤',
        title: 'Perfil y Temas',
        desc: 'Personaliza tu perfil con foto, bio, badges y temas de color. Configura tu privacidad, conecta tu cuenta de Bluesky o X, y gestiona tus preferencias.',
      },
      {
        icon: '⭐',
        title: 'Canal PRIME de Telegram',
        desc: 'Como miembro PRIME, tienes acceso exclusivo al canal de Telegram con contenido premium, anuncios anticipados y beneficios especiales. Usa tu enlace de invitacion unico.',
      },
      {
        icon: '📅',
        title: 'Reservas (Booking)',
        desc: 'Agenda sesiones privadas y consultas con performers a traves de nuestro sistema de reservas integrado. Disponible para miembros PRIME.',
      },
      {
        icon: '🎵',
        title: 'Radio 24/7',
        desc: 'Escucha musica las 24 horas del dia, los 7 dias de la semana. Navega por la biblioteca de audio, busca artistas y disfruta de transmision continua.',
      },
    ] : [
      {
        icon: '📍',
        title: 'Nearby (Who\'s Around)',
        desc: 'Discover members and venues near you using geolocation. Enable your location in Profile > Location to appear on the map and see nearby members.',
      },
      {
        icon: '✉️',
        title: 'Chat & Direct Messages',
        desc: 'Chat in group rooms inside Hangouts or send private direct messages to any member. Supports text, images, and videos.',
      },
      {
        icon: '👤',
        title: 'Profile & Themes',
        desc: 'Customize your profile with a photo, bio, badges, and color themes. Set your privacy, connect your Bluesky or X account, and manage preferences.',
      },
      {
        icon: '⭐',
        title: 'PRIME Telegram Channel',
        desc: 'As a PRIME member, you have exclusive access to the Telegram channel with premium content, early announcements, and special perks. Use your unique invite link.',
      },
      {
        icon: '📅',
        title: 'Booking',
        desc: 'Schedule private sessions and consultations with performers through our integrated booking system. Available for PRIME members.',
      },
      {
        icon: '🎵',
        title: '24/7 Radio',
        desc: 'Listen to music around the clock. Browse the audio library, search artists, and enjoy continuous streaming.',
      },
    ];

    for (const feat of features2) {
      if (y > 720) break;
      doc.rect(50, y, contentW, 60).fill(LIGHT_BG);
      doc.fontSize(12).fill(DARK).text(`${feat.icon}  ${feat.title}`, 65, y + 8, { width: contentW - 30 });
      doc.fontSize(9).fill(GRAY).text(feat.desc, 65, y + 26, { width: contentW - 30, lineGap: 2 });
      y += 68;
    }

    // ═══════════════════════════════════════════════
    // PAGE 3 — Quick reference + support
    // ═══════════════════════════════════════════════
    doc.addPage();

    // Header bar
    doc.rect(0, 0, pageW, 60).fill(DARK);
    doc.fontSize(20).fill(WHITE).text('PNPtv', 50, 18, { continued: true });
    doc.fontSize(10).fill(ACCENT).text('!', { continued: true });
    doc.fill('#AAAAAA').text(
      isEs ? '  — Inicio Rapido' : '  — Quick Start',
      { continued: false }
    );

    y = 85;
    doc.fontSize(16).fill(DARK).text(
      isEs ? 'Lista de Inicio Rapido' : 'Quick Start Checklist',
      50, y, { align: 'center', width: contentW }
    );

    y += 35;
    const checklist = isEs ? [
      'Visita https://pnptv.app e inicia sesion',
      'Completa tu perfil con foto y bio',
      'Explora Videorama para ver contenido exclusivo',
      'Unete a un Hangout o crea tu propio grupo',
      'Publica tu primer post en el Social Feed',
      'Activa tu ubicacion para ver miembros cercanos',
      'Unete al Canal PRIME de Telegram con tu enlace de invitacion',
      'Envia un mensaje directo a alguien de la comunidad',
    ] : [
      'Visit https://pnptv.app and log in',
      'Complete your profile with a photo and bio',
      'Explore Videorama for exclusive content',
      'Join a Hangout or create your own group',
      'Publish your first post on the Social Feed',
      'Enable your location to see nearby members',
      'Join the PRIME Telegram Channel with your invite link',
      'Send a direct message to someone in the community',
    ];

    for (const item of checklist) {
      doc.fontSize(11).fill(ACCENT).text('✓', 60, y, { continued: true });
      doc.fill(DARK).text(`  ${item}`, { continued: false });
      y += 22;
    }

    // Support section
    y += 25;
    doc.moveTo(50, y).lineTo(pageW - 50, y).strokeColor(ACCENT).lineWidth(1).stroke();

    y += 20;
    doc.fontSize(14).fill(ACCENT).text(
      isEs ? 'Necesitas Ayuda?' : 'Need Help?',
      50, y, { align: 'center', width: contentW }
    );

    y += 30;
    doc.fontSize(10).fill(GRAY).text(
      isEs
        ? 'Nuestro equipo de soporte esta disponible para ayudarte en cualquier momento.'
        : 'Our support team is available to help you anytime.',
      50, y, { align: 'center', width: contentW }
    );

    y += 25;
    const supportItems = [
      [isEs ? 'Bot de Telegram' : 'Telegram Bot', '@PNPtvBot'],
      ['Email', 'support@pnptv.app'],
      ['Web', 'https://pnptv.app/support'],
    ];

    for (const [label, value] of supportItems) {
      doc.fontSize(10).fill(GRAY).text(`${label}: `, 180, y, { continued: true, width: 200 });
      doc.fill(DARK).text(value, { continued: false });
      y += 18;
    }

    // Footer
    y = doc.page.height - 80;
    doc.moveTo(50, y).lineTo(pageW - 50, y).strokeColor('#DDDDDD').lineWidth(0.5).stroke();
    y += 12;
    doc.fontSize(8).fill(GRAY);
    doc.text('PNPtv! | support@pnptv.app | https://pnptv.app', 50, y, {
      align: 'center', width: contentW,
    });
    doc.text(
      isEs
        ? 'Este documento es tu guia personal de uso. Guardalo para referencia futura.'
        : 'This document is your personal usage guide. Save it for future reference.',
      50, y + 14, { align: 'center', width: contentW }
    );

    doc.end();
    const buffer = await done;
    return { buffer };
  }
}

module.exports = InvoiceService;

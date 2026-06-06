const { Markup } = require('telegraf');
const logger = require('../../../utils/logger');
const { getLanguage } = require('../../utils/helpers');

/**
 * Payment Tutorial Handler
 * Sends detailed step-by-step guides for every payment method.
 * Bilingual: Spanish (es) / English (en)
 */
const registerPaymentTutorialHandlers = (bot) => {

  // /pay command — main tutorial menu
  bot.command('pay', handlePayMenu);

  // Action handlers for each payment method tutorial
  bot.action('pay_menu', handlePayMenu);
  bot.action('pay_tut_epayco', handleEpaycoTutorial);
  bot.action('pay_tut_dash', handleDashTutorial);
  bot.action('pay_tut_meru', handleMeruTutorial);
  bot.action('pay_tut_plans', handlePlansTutorial);
  bot.action('pay_tut_faq', handlePayFAQ);

  logger.info('Payment tutorial handlers registered');
};

// ─── MAIN MENU ───────────────────────────────────────────────

async function handlePayMenu(ctx) {
  try {
    const lang = getLanguage(ctx);

    const text = lang === 'es'
      ? `💰 *Guia de Pagos PNPtv*

Aprende paso a paso como pagar tu suscripcion con cualquiera de nuestros metodos de pago.

Selecciona un metodo para ver el tutorial completo:`
      : `💰 *PNPtv Payment Guide*

Learn step by step how to pay for your subscription with any of our payment methods.

Select a method to see the full tutorial:`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(
        lang === 'es' ? '📋 Ver Planes y Precios' : '📋 View Plans & Pricing',
        'pay_tut_plans'
      )],
      [Markup.button.callback(
        '💳 ePayco (Tarjeta / PSE)',
        'pay_tut_epayco'
      )],
      [Markup.button.callback(
        '🥷 Dash (Crypto Anonimo)',
        'pay_tut_dash'
      )],
      [Markup.button.callback(
        '🔗 Meru (Link de Pago)',
        'pay_tut_meru'
      )],
      [Markup.button.callback(
        lang === 'es' ? '❓ Preguntas Frecuentes' : '❓ FAQ',
        'pay_tut_faq'
      )],
      [Markup.button.url(
        lang === 'es' ? '🌐 Ir a Suscribirse' : '🌐 Go to Subscribe',
        'https://pnptv.app/subscribe'
      )],
    ]);

    if (ctx.callbackQuery) {
      await ctx.answerCbQuery();
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    } else {
      await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
    }
  } catch (error) {
    logger.error('Error in pay menu:', error);
  }
}

// ─── PLANS & PRICING ────────────────────────────────────────

async function handlePlansTutorial(ctx) {
  try {
    const lang = getLanguage(ctx);
    await ctx.answerCbQuery();

    const text = lang === 'es'
      ? `📋 *Planes y Precios*

🟢 *PNP Member* — $9.99 USD / mes
├ Salas de grupo en Hangouts
├ Feed Social completo
├ Descubrimiento Nearby
└ Perfil verificado

⭐ *PRIME Trial* — $15.00 USD / 7 dias
├ Acceso PRIME completo por 1 semana
└ Ideal para probar todas las funciones

⭐ *Monthly PRIME* — $25.00 USD / mes
├ Todo lo de Member +
├ Mensajes directos ilimitados
├ Videollamadas privadas
└ Contenido exclusivo PRIME

💎 *Crystal PRIME* — $49.99 USD / 6 meses
├ Todo lo de Monthly PRIME
├ Ahorra $8.33/mes vs mensual
└ 6 meses de acceso completo

💎 *Diamond PRIME* — $99.99 USD / 1 año
├ Todo lo de Crystal PRIME
├ Ahorra $16.66/mes vs mensual
└ 12 meses de acceso completo

👑 *Lifetime PRIME* — $249.99 USD (pago unico)
├ Acceso PRIME para siempre
├ Badge de Fundador exclusivo
└ Nunca mas pagues por PNPtv

💱 *Precios en COP:* Multiplica x 4,000
Ejemplo: $25.00 USD = ~$99,960 COP`
      : `📋 *Plans & Pricing*

🟢 *PNP Member* — $9.99 USD / month
├ Hangout group rooms
├ Full Social feed
├ Nearby discovery
└ Verified profile

⭐ *PRIME Trial* — $15.00 USD / 7 days
├ Full PRIME access for 1 week
└ Perfect to try all features

⭐ *Monthly PRIME* — $25.00 USD / month
├ Everything in Member +
├ Unlimited direct messages
├ Private video calls
└ Exclusive PRIME content

💎 *Crystal PRIME* — $49.99 USD / 6 months
├ Everything in Monthly PRIME
├ Save $8.33/mo vs monthly
└ 6 months of full access

💎 *Diamond PRIME* — $99.99 USD / 1 year
├ Everything in Crystal PRIME
├ Save $16.66/mo vs monthly
└ 12 months of full access

👑 *Lifetime PRIME* — $249.99 USD (one-time)
├ PRIME access forever
├ Exclusive Founder badge
└ Never pay for PNPtv again

💱 *COP Pricing:* Multiply x 4,000
Example: $25.00 USD = ~$99,960 COP`;

    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.url(
          lang === 'es' ? '🌐 Suscribirse Ahora' : '🌐 Subscribe Now',
          'https://pnptv.app/subscribe'
        )],
        [Markup.button.callback(lang === 'es' ? '🔙 Volver al Menu' : '🔙 Back to Menu', 'pay_menu')],
      ]),
    });
  } catch (error) {
    logger.error('Error in plans tutorial:', error);
  }
}

// ─── EPAYCO TUTORIAL ─────────────────────────────────────────

async function handleEpaycoTutorial(ctx) {
  try {
    const lang = getLanguage(ctx);
    await ctx.answerCbQuery();

    const text = lang === 'es'
      ? `💳 *Tutorial: Pagar con ePayco*
_(Tarjeta de Credito, Debito, PSE, Efecty, Baloto)_

*Que es ePayco?*
Pasarela de pagos colombiana que acepta tarjetas internacionales, PSE (transferencia bancaria) y pagos en efectivo.

*Paso a Paso:*

*1.* Abre la pagina de suscripcion:
   pnptv.app/subscribe

*2.* Selecciona tu plan (Member, PRIME, etc.)

*3.* Escribe tu email
   ⚠️ Usa un email real — ahi recibiras tus credenciales de acceso

*4.* Selecciona el tab "💳 Card / PSE"

*5.* Haz clic en "Subscribe Now"
   → Se abre una nueva pestaña con el checkout de ePayco

*6.* En la pagina de ePayco:
   *Para Tarjeta:*
   ├ Ingresa numero de tarjeta
   ├ Fecha de expiracion
   ├ CVV (codigo de seguridad)
   ├ Nombre del titular
   └ Haz clic en "Pagar"

   *Para PSE:*
   ├ Selecciona "PSE" como metodo
   ├ Elige tu banco
   ├ Tipo: persona natural o juridica
   └ Seras redirigido a tu banco

   *Para Efectivo:*
   ├ Selecciona "Efectivo"
   ├ Elige Efecty o Baloto
   └ Recibiras un numero de convenio

*7.* Espera la confirmacion
   → La pagina muestra "Verificando pago..."
   → Puede tomar hasta 5 minutos
   → Si usaste 3D Secure, confirma en tu app bancaria

*8.* Listo! Recibiras un email con:
   ├ Tu usuario y contraseña
   ├ Link para iniciar sesion
   └ Factura del pago

*Tarjetas aceptadas:*
Visa, Mastercard, American Express

*Monedas:* USD y COP (conversion automatica)`
      : `💳 *Tutorial: Pay with ePayco*
_(Credit Card, Debit Card, PSE, Efecty, Baloto)_

*What is ePayco?*
Colombian payment gateway that accepts international cards, PSE (bank transfers) and cash payments.

*Step by Step:*

*1.* Open the subscription page:
   pnptv.app/subscribe

*2.* Select your plan (Member, PRIME, etc.)

*3.* Enter your email
   ⚠️ Use a real email — your login credentials will be sent there

*4.* Select the "💳 Card / PSE" tab

*5.* Click "Subscribe Now"
   → A new tab opens with ePayco checkout

*6.* On the ePayco page:
   *For Card:*
   ├ Enter card number
   ├ Expiration date
   ├ CVV (security code)
   ├ Cardholder name
   └ Click "Pay"

   *For PSE (Bank Transfer):*
   ├ Select "PSE" as method
   ├ Choose your bank
   ├ Type: personal or business
   └ You'll be redirected to your bank

   *For Cash:*
   ├ Select "Cash"
   ├ Choose Efecty or Baloto
   └ You'll get a payment reference number

*7.* Wait for confirmation
   → Page shows "Verifying payment..."
   → May take up to 5 minutes
   → If using 3D Secure, confirm in your banking app

*8.* Done! You'll receive an email with:
   ├ Your username & password
   ├ Login link
   └ Payment invoice

*Accepted cards:*
Visa, Mastercard, American Express

*Currencies:* USD and COP (auto-conversion)`;

    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.url(
          lang === 'es' ? '🌐 Pagar con ePayco' : '🌐 Pay with ePayco',
          'https://pnptv.app/subscribe'
        )],
        [Markup.button.callback(lang === 'es' ? '🔙 Volver al Menu' : '🔙 Back to Menu', 'pay_menu')],
      ]),
    });
  } catch (error) {
    logger.error('Error in ePayco tutorial:', error);
  }
}

// ─── DAIMO TUTORIAL ──────────────────────────────────────────

async function handleDaimoTutorial(ctx) {
  try {
    const lang = getLanguage(ctx);
    await ctx.answerCbQuery();

    const text = lang === 'es'
      ? `🪙 *Tutorial: Pagar con Daimo (USDC)*
_(Crypto Wallets, Coinbase, MetaMask, Apple Pay, Tarjeta)_

*Que es Daimo?*
Plataforma de pago con USDC (dolar digital) en la red Optimism. Acepta crypto wallets, exchanges Y tarjetas.

*Paso a Paso:*

*1.* Abre la pagina de suscripcion:
   pnptv.app/subscribe

*2.* Selecciona tu plan

*3.* Escribe tu email
   ⚠️ Usa un email real — ahi recibiras tus credenciales

*4.* Selecciona el tab "🪙 USDC"

*5.* Haz clic en "Subscribe Now"
   → Aparece un modal de Daimo dentro de la pagina

*6.* En el modal de Daimo, elige como pagar:

   *Desde Crypto Wallet:*
   ├ Selecciona tu wallet (MetaMask, Coinbase, Trust)
   ├ Conecta tu wallet
   ├ Aprueba la transaccion
   └ Confirma el envio de USDC

   *Desde Exchange:*
   ├ Selecciona Coinbase, Binance o Kraken
   ├ Sigue las instrucciones del exchange
   └ El pago se procesa automaticamente

   *Con Tarjeta / Apple Pay:*
   ├ Selecciona "Card" o "Apple Pay"
   ├ Ingresa los datos de tu tarjeta
   └ Daimo convierte a USDC automaticamente

*7.* Espera la confirmacion en blockchain
   → Generalmente toma 10-30 segundos
   → La pagina muestra el progreso en tiempo real

*8.* Listo! Recibiras un email con:
   ├ Tu usuario y contraseña
   ├ Link para iniciar sesion
   └ Factura del pago

*Wallets compatibles:*
MetaMask, Coinbase Wallet, Trust Wallet, Daimo, Rainbow, y mas

*Ventajas:*
├ Rapido (segundos, no minutos)
├ Bajo costo (red Optimism)
├ Multiple formas de pago en un solo modal
└ Sin friccion — no necesitas tener crypto previamente`
      : `🪙 *Tutorial: Pay with Daimo (USDC)*
_(Crypto Wallets, Coinbase, MetaMask, Apple Pay, Card)_

*What is Daimo?*
Payment platform using USDC (digital dollar) on the Optimism network. Accepts crypto wallets, exchanges AND cards.

*Step by Step:*

*1.* Open the subscription page:
   pnptv.app/subscribe

*2.* Select your plan

*3.* Enter your email
   ⚠️ Use a real email — your login credentials will be sent there

*4.* Select the "🪙 USDC" tab

*5.* Click "Subscribe Now"
   → A Daimo modal appears within the page

*6.* In the Daimo modal, choose how to pay:

   *From Crypto Wallet:*
   ├ Select your wallet (MetaMask, Coinbase, Trust)
   ├ Connect your wallet
   ├ Approve the transaction
   └ Confirm the USDC transfer

   *From Exchange:*
   ├ Select Coinbase, Binance or Kraken
   ├ Follow the exchange instructions
   └ Payment processes automatically

   *With Card / Apple Pay:*
   ├ Select "Card" or "Apple Pay"
   ├ Enter your card details
   └ Daimo converts to USDC automatically

*7.* Wait for blockchain confirmation
   → Usually takes 10-30 seconds
   → Page shows real-time progress

*8.* Done! You'll receive an email with:
   ├ Your username & password
   ├ Login link
   └ Payment invoice

*Compatible wallets:*
MetaMask, Coinbase Wallet, Trust Wallet, Daimo, Rainbow, and more

*Advantages:*
├ Fast (seconds, not minutes)
├ Low cost (Optimism network)
├ Multiple payment methods in one modal
└ Frictionless — no need to own crypto beforehand`;

    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.url(
          lang === 'es' ? '🌐 Pagar con Daimo' : '🌐 Pay with Daimo',
          'https://pnptv.app/subscribe'
        )],
        [Markup.button.callback(lang === 'es' ? '🔙 Volver al Menu' : '🔙 Back to Menu', 'pay_menu')],
      ]),
    });
  } catch (error) {
    logger.error('Error in Daimo tutorial:', error);
  }
}

// ─── DASH TUTORIAL ───────────────────────────────────────────

async function handleDashTutorial(ctx) {
  try {
    const lang = getLanguage(ctx);
    await ctx.answerCbQuery();

    const text = lang === 'es'
      ? `🥷 *Tutorial: Pagar con Dash*
_(Pago 100% Anonimo con Criptomoneda)_

*Que es Dash?*
Criptomoneda enfocada en privacidad y velocidad. Tus pagos son anonimos — no se vinculan a tu identidad.

*Paso a Paso:*

*1.* Abre la pagina de suscripcion:
   pnptv.app/subscribe

*2.* Selecciona tu plan

*3.* Escribe tu email
   ⚠️ Usa un email real — ahi recibiras tus credenciales

*4.* Selecciona el tab "🥷 Dash"

*5.* Haz clic en "Subscribe Now"
   → Aparece un modal con "Esperando pago Dash..."

*6.* Haz clic en "Open Dash Checkout"
   → Se abre la pagina de BTCPay con:
   ├ Direccion de Dash para enviar el pago
   ├ Codigo QR (escanea con tu wallet)
   └ Monto exacto en DASH

*7.* Enviar el pago desde tu wallet:

   *Desde Dash Wallet (celular):*
   ├ Abre tu app Dash Wallet
   ├ Escanea el codigo QR
   ├ Verifica el monto
   └ Confirma el envio

   *Desde Exchange (Kraken, Uphold):*
   ├ Ve a "Enviar/Withdraw" en tu exchange
   ├ Pega la direccion Dash del checkout
   ├ Ingresa el monto exacto
   └ Confirma el retiro

*8.* Espera la confirmacion en blockchain
   → Dash es rapido — generalmente 2-5 minutos
   → El modal se cierra automaticamente al confirmar

*9.* Listo! Recibiras un email con:
   ├ Tu usuario y contraseña
   ├ Link para iniciar sesion
   └ Factura del pago

*No tienes Dash?*
├ Compra en Kraken (kraken.com)
├ Compra en Uphold (uphold.com)
└ Descarga Dash Wallet (dash.org)

*Ventajas:*
├ 100% anonimo
├ Sin vincular tarjeta o banco
├ Transacciones rapidas
└ Bajas comisiones`
      : `🥷 *Tutorial: Pay with Dash*
_(100% Anonymous Cryptocurrency Payment)_

*What is Dash?*
Cryptocurrency focused on privacy and speed. Your payments are anonymous — not linked to your identity.

*Step by Step:*

*1.* Open the subscription page:
   pnptv.app/subscribe

*2.* Select your plan

*3.* Enter your email
   ⚠️ Use a real email — your login credentials will be sent there

*4.* Select the "🥷 Dash" tab

*5.* Click "Subscribe Now"
   → A modal appears showing "Waiting for Dash payment..."

*6.* Click "Open Dash Checkout"
   → BTCPay page opens showing:
   ├ Dash address to send payment
   ├ QR code (scan with your wallet)
   └ Exact amount in DASH

*7.* Send payment from your wallet:

   *From Dash Wallet (mobile):*
   ├ Open your Dash Wallet app
   ├ Scan the QR code
   ├ Verify the amount
   └ Confirm the send

   *From Exchange (Kraken, Uphold):*
   ├ Go to "Send/Withdraw" on your exchange
   ├ Paste the Dash address from checkout
   ├ Enter the exact amount
   └ Confirm withdrawal

*8.* Wait for blockchain confirmation
   → Dash is fast — usually 2-5 minutes
   → Modal auto-closes when confirmed

*9.* Done! You'll receive an email with:
   ├ Your username & password
   ├ Login link
   └ Payment invoice

*Don't have Dash?*
├ Buy on Kraken (kraken.com)
├ Buy on Uphold (uphold.com)
└ Download Dash Wallet (dash.org)

*Advantages:*
├ 100% anonymous
├ No card or bank linked
├ Fast transactions
└ Low fees`;

    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.url(
          lang === 'es' ? '🌐 Pagar con Dash' : '🌐 Pay with Dash',
          'https://pnptv.app/subscribe'
        )],
        [Markup.button.callback(lang === 'es' ? '🔙 Volver al Menu' : '🔙 Back to Menu', 'pay_menu')],
      ]),
    });
  } catch (error) {
    logger.error('Error in Dash tutorial:', error);
  }
}

// ─── MERU TUTORIAL ───────────────────────────────────────────

async function handleMeruTutorial(ctx) {
  try {
    const lang = getLanguage(ctx);
    await ctx.answerCbQuery();

    const text = lang === 'es'
      ? `🔗 *Tutorial: Pagar con Meru*
_(Link de Pago con Codigo)_

*Que es Meru?*
Plataforma de links de pago. Recibes un link para pagar y luego activas con un codigo en PNPtv.

*Paso a Paso:*

*1.* Recibe tu link de pago Meru
   → Te lo envia un admin o lo encuentras en promociones
   → Formato: pay.getmeru.com/CODIGO

*2.* Abre el link de Meru y completa el pago
   → Meru acepta multiples metodos de pago
   → Sigue las instrucciones en la pagina de Meru

*3.* Una vez pagado, abre la pagina de suscripcion:
   pnptv.app/subscribe

*4.* Escribe tu email arriba del formulario
   ⚠️ Usa un email real — ahi recibiras tus credenciales

*5.* Busca la seccion "Have a Meru code?" abajo de los metodos de pago

*6.* Ingresa tu codigo Meru en el campo de texto
   → Es el codigo corto del link (ej: "daq\\_Ak")

*7.* Haz clic en "Activate"
   → El sistema verifica que el pago fue completado en Meru

*8.* Listo! Seras redirigido a la pagina de bienvenida
   → Recibiras un email con:
   ├ Tu usuario y contraseña
   ├ Link para iniciar sesion
   └ Detalles de tu suscripcion

*Importante:*
├ Primero paga en el link de Meru
├ Luego activa en PNPtv con el codigo
└ El codigo es de un solo uso`
      : `🔗 *Tutorial: Pay with Meru*
_(Payment Link with Code)_

*What is Meru?*
Payment link platform. You receive a link to pay, then activate with a code on PNPtv.

*Step by Step:*

*1.* Receive your Meru payment link
   → Sent by an admin or found in promotions
   → Format: pay.getmeru.com/CODE

*2.* Open the Meru link and complete payment
   → Meru accepts multiple payment methods
   → Follow the instructions on the Meru page

*3.* Once paid, open the subscription page:
   pnptv.app/subscribe

*4.* Enter your email at the top of the form
   ⚠️ Use a real email — your login credentials will be sent there

*5.* Look for the "Have a Meru code?" section below the payment methods

*6.* Enter your Meru code in the text field
   → It's the short code from the link (e.g., "daq\\_Ak")

*7.* Click "Activate"
   → System verifies that payment was completed on Meru

*8.* Done! You'll be redirected to the welcome page
   → You'll receive an email with:
   ├ Your username & password
   ├ Login link
   └ Subscription details

*Important:*
├ Pay on the Meru link first
├ Then activate on PNPtv with the code
└ The code is single-use`;

    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.url(
          lang === 'es' ? '🌐 Activar Codigo Meru' : '🌐 Activate Meru Code',
          'https://pnptv.app/subscribe'
        )],
        [Markup.button.callback(lang === 'es' ? '🔙 Volver al Menu' : '🔙 Back to Menu', 'pay_menu')],
      ]),
    });
  } catch (error) {
    logger.error('Error in Meru tutorial:', error);
  }
}

// ─── FAQ ─────────────────────────────────────────────────────

async function handlePayFAQ(ctx) {
  try {
    const lang = getLanguage(ctx);
    await ctx.answerCbQuery();

    const text = lang === 'es'
      ? `❓ *Preguntas Frecuentes sobre Pagos*

*P: Mi pago fue exitoso pero no recibo el email*
R: Revisa tu carpeta de spam. Si no llega en 10 minutos, escribe a /support

*P: Mi tarjeta fue rechazada*
R: Intenta con otra tarjeta o paga con Dash (cripto, sin banco). Tambien puedes pagar en efectivo via Efecty/Baloto con ePayco.

*P: Puedo pagar desde fuera de Colombia?*
R: Si! ePayco acepta tarjetas internacionales (Visa, MC, Amex). Dash es global y no requiere banco.

*P: El pago dice "pendiente" hace mucho tiempo*
R: Para ePayco con 3D Secure, confirma en tu app bancaria. Para Dash, espera la confirmacion en blockchain (2-5 min). Si pasan mas de 30 minutos, escribe a /support

*P: Puedo pagar anonimamente?*
R: Si! Usa Dash para pagos 100% anonimos. Ningun dato personal vinculado al pago.

*P: Puedo cambiar de plan despues?*
R: Si, al vencer tu plan actual puedes elegir uno diferente. Los upgrades se aplican inmediatamente.

*P: Cuantas veces puedo usar un codigo Meru?*
R: Una sola vez. Cada codigo es unico y de uso unico.

*P: Que pasa si pago en COP?*
R: ePayco convierte automaticamente a COP usando la tasa 1 USD = 4,000 COP. El monto exacto se muestra antes de pagar.

*P: Es seguro pagar aqui?*
R: Si! Nunca almacenamos datos de tarjetas. ePayco es un procesador certificado PCI-DSS y los pagos en Dash van directo a la blockchain. Todos los pagos usan encriptacion SSL.`
      : `❓ *Payment FAQ*

*Q: Payment succeeded but I didn't receive the email*
A: Check your spam folder. If it doesn't arrive within 10 minutes, write to /support

*Q: My card was declined*
A: Try another card or pay with Dash (crypto, no bank required). You can also pay cash via Efecty/Baloto through ePayco.

*Q: Can I pay from outside Colombia?*
A: Yes! ePayco accepts international cards (Visa, MC, Amex). Dash is global and needs no bank.

*Q: Payment has been "pending" for a long time*
A: For ePayco with 3D Secure, confirm in your banking app. For Dash, wait for blockchain confirmation (2-5 min). If over 30 minutes, write to /support

*Q: Can I pay anonymously?*
A: Yes! Use Dash for 100% anonymous payments. No personal data linked to the payment.

*Q: Can I change my plan later?*
A: Yes, when your current plan expires you can choose a different one. Upgrades apply immediately.

*Q: How many times can I use a Meru code?*
A: Once. Each code is unique and single-use.

*Q: What happens if I pay in COP?*
A: ePayco auto-converts to COP using the rate 1 USD = 4,000 COP. The exact amount is shown before paying.

*Q: Is it safe to pay here?*
A: Yes! We never store card data. ePayco is a PCI-DSS certified processor and Dash payments settle directly on the blockchain. All payments use SSL encryption.`;

    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback(
          lang === 'es' ? '💬 Contactar Soporte' : '💬 Contact Support',
          'support_contact_admin'
        )],
        [Markup.button.callback(lang === 'es' ? '🔙 Volver al Menu' : '🔙 Back to Menu', 'pay_menu')],
      ]),
    });
  } catch (error) {
    logger.error('Error in pay FAQ:', error);
  }
}

module.exports = registerPaymentTutorialHandlers;

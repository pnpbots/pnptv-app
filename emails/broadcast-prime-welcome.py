#!/usr/bin/env python3
"""Broadcast PRIME welcome message to all prime members via Telegram Bot API."""

import subprocess
import time
import json
import urllib.request
import urllib.error

BOT_TOKEN = "8571930103:AAGmpAQUCzDkqj3I9WxaJQwEm-ZJt1gyUUw"
API_BASE = f"https://api.telegram.org/bot{BOT_TOKEN}"

# ── Messages (HTML parse mode — no escaping nightmares) ────────────────────

MSG_EN = """🎬 <b>Your PNPtv! PRIME Account is Ready</b>

Welcome to <b>PNPtv!</b> — the private community platform built by and for the queer PNP community. Your PRIME membership is now active and all features are unlocked.

<b>What is PNPtv!?</b>
Your all-in-one platform for PNP content, live video rooms, raw podcasts, and real community connections. A private social network where you can watch, chat, discover people nearby, and connect — all in one place.

🎬 <b>PRIME Content</b> — Exclusive video library with curated PNP content
🔴 <b>Live Video Rooms</b> — Join or host live video sessions in real time
👥 <b>Hangout Groups</b> — Group chats with video call support
📍 <b>Nearby Discovery</b> — Find community members near you
💬 <b>Social Feed</b> — Post, like, comment &amp; share with the community
✉️ <b>Direct Messages</b> — Private messaging with any member

<b>Getting Started:</b>

1️⃣ Send /start to this bot to begin
2️⃣ Complete onboarding (age, guidelines, profile) — takes 2 min
3️⃣ Tap <b>"Open App"</b> below or visit <a href="https://pnptv.app">pnptv.app</a>
4️⃣ Explore PRIME content, hangouts, live rooms &amp; more!

<b>Your PRIME Perks:</b>
✅ Full access to the exclusive PRIME video library
✅ Create and join Hangout groups with video calls
✅ Host and watch live video streams
✅ Nearby discovery — find members in your area
✅ Post, like, comment &amp; share on the Social Feed
✅ Direct messaging with any community member
✅ Priority support

Need help? Type /help anytime or email support@pnptv.app"""

MSG_ES = """🎬 <b>Tu Cuenta PRIME en PNPtv! Está Lista</b>

Bienvenido a <b>PNPtv!</b> — la plataforma privada de comunidad creada por y para la comunidad queer PNP. Tu membresía PRIME está activa y todas las funciones están desbloqueadas.

<b>¿Qué es PNPtv!?</b>
Tu plataforma todo-en-uno para contenido PNP, salas de video en vivo, podcasts crudos y conexiones reales con la comunidad. Una red social privada donde puedes ver, chatear, descubrir gente cerca y conectar — todo en un solo lugar.

🎬 <b>Contenido PRIME</b> — Biblioteca exclusiva de videos PNP curados
🔴 <b>Salas de Video en Vivo</b> — Únete o crea sesiones en tiempo real
👥 <b>Grupos de Hangout</b> — Chats grupales con videollamada
📍 <b>Descubre Gente Cerca</b> — Encuentra miembros cerca de ti
💬 <b>Feed Social</b> — Publica, dale like, comenta y comparte
✉️ <b>Mensajes Directos</b> — Mensajes privados con cualquier miembro

<b>Cómo Empezar:</b>

1️⃣ Envía /start a este bot para comenzar
2️⃣ Completa el registro (edad, normas, perfil) — toma 2 min
3️⃣ Toca <b>"Abrir App"</b> abajo o visita <a href="https://pnptv.app">pnptv.app</a>
4️⃣ Explora contenido PRIME, hangouts, salas en vivo y más!

<b>Tus Beneficios PRIME:</b>
✅ Acceso completo a la biblioteca exclusiva de videos PRIME
✅ Crea y únete a grupos de Hangout con videollamadas
✅ Transmite y mira streams de video en vivo
✅ Descubre gente cerca — encuentra miembros en tu zona
✅ Publica, dale like, comenta y comparte en el Feed Social
✅ Mensajes directos con cualquier miembro de la comunidad
✅ Soporte prioritario

¿Necesitas ayuda? Escribe /help en cualquier momento o envía un correo a support@pnptv.app"""

# Inline keyboard with "Open App" button
KEYBOARD_EN = {
    "inline_keyboard": [
        [{"text": "🚀 Open PNPtv! App", "web_app": {"url": "https://pnptv.app"}}],
        [{"text": "💬 Need Help? /help", "callback_data": "help_menu"}]
    ]
}

KEYBOARD_ES = {
    "inline_keyboard": [
        [{"text": "🚀 Abrir PNPtv! App", "web_app": {"url": "https://pnptv.app"}}],
        [{"text": "💬 ¿Ayuda? /help", "callback_data": "help_menu"}]
    ]
}

# ── Get users from DB ───────────────────────────────────────────────────────
result = subprocess.run(
    [
        "docker", "exec", "pg-pnptv",
        "psql", "-U", "pnptvbot", "-d", "pnptvbot",
        "-t", "-A", "-F", "|",
        "-c", "SELECT telegram, language, username FROM users WHERE telegram IS NOT NULL AND tier = 'prime' ORDER BY id;"
    ],
    capture_output=True, text=True
)

users = []
for line in result.stdout.strip().split("\n"):
    if not line.strip():
        continue
    parts = line.split("|")
    if len(parts) >= 2:
        tg_id = parts[0].strip()
        lang = parts[1].strip()
        username = parts[2].strip() if len(parts) > 2 else ""
        if tg_id:
            users.append({"telegram": tg_id, "lang": lang, "username": username})

print(f"Found {len(users)} PRIME members to broadcast")
print(f"  English: {sum(1 for u in users if u['lang'] != 'es')}")
print(f"  Spanish: {sum(1 for u in users if u['lang'] == 'es')}")
print()

# ── Send messages ───────────────────────────────────────────────────────────
sent = 0
failed = 0
blocked = 0
failures = []

for i, user in enumerate(users):
    tg_id = user["telegram"]
    lang = user["lang"]
    is_es = lang == "es"

    message = MSG_ES if is_es else MSG_EN
    keyboard = KEYBOARD_ES if is_es else KEYBOARD_EN

    payload = json.dumps({
        "chat_id": tg_id,
        "text": message,
        "parse_mode": "HTML",
        "reply_markup": keyboard,
        "disable_web_page_preview": True
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{API_BASE}/sendMessage",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            sent += 1
            tag = "ES" if is_es else "EN"
            print(f"  [{sent}/{len(users)}] [{tag}] Sent to {tg_id} ({user['username'] or 'no-username'})")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            err_data = json.loads(body)
            desc = err_data.get("description", "")
        except:
            desc = body

        if "blocked" in desc.lower() or "deactivated" in desc.lower():
            blocked += 1
            print(f"  [BLOCKED] {tg_id}: {desc}")
        elif "Too Many Requests" in desc:
            retry_after = 1
            try:
                retry_after = json.loads(body).get("parameters", {}).get("retry_after", 5)
            except:
                pass
            print(f"  [RATE] Waiting {retry_after}s...")
            time.sleep(retry_after + 0.5)
            try:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    sent += 1
                    tag = "ES" if is_es else "EN"
                    print(f"  [{sent}/{len(users)}] [{tag}] Sent to {tg_id} (retry)")
            except Exception as e2:
                failed += 1
                failures.append({"tg_id": tg_id, "error": str(e2)})
                print(f"  [FAIL] {tg_id}: {e2}")
        else:
            failed += 1
            failures.append({"tg_id": tg_id, "error": desc})
            print(f"  [FAIL] {tg_id}: {desc}")
    except Exception as e:
        failed += 1
        failures.append({"tg_id": tg_id, "error": str(e)})
        print(f"  [FAIL] {tg_id}: {e}")

    # ~12 msgs/sec to stay safe under Telegram's 30/sec limit
    if i < len(users) - 1:
        time.sleep(0.08)

print()
print(f"Done! Sent: {sent}, Blocked: {blocked}, Failed: {failed}")
if failures:
    print("Failed:")
    for f in failures:
        print(f"  - {f['tg_id']}: {f['error']}")

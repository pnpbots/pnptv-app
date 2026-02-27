#!/usr/bin/env python3
"""Send PRIME welcome email to all prime members, in their preferred language."""

import smtplib
import ssl
import subprocess
import json
import time
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

# ── Config ──────────────────────────────────────────────────────────────────
SMTP_HOST = "smtp.hostinger.com"
SMTP_PORT = 465
SMTP_USER = "hello@easybots.store"
SMTP_PASS = "Apelo801050#"
FROM_NAME = "PNPtv!"
FROM_EMAIL = SMTP_USER
REPLY_TO = "support@pnptv.app"

SUBJECT_EN = "Your PNPtv! PRIME Account is Ready"
SUBJECT_ES = "Tu Cuenta PRIME en PNPtv! Esta Lista"

PLAIN_EN = """Your PNPtv! PRIME Account is Ready

Welcome to PNPtv! Your PRIME membership is now active.

Getting Started:
1. Open Telegram and search for @PNPLatinoTV_bot
2. Send /start and complete onboarding
3. Tap "Open App" or visit https://pnptv.app
4. Explore PRIME content, live rooms, hangouts & more

Need help? Email support@pnptv.app or type /help in the bot.
"""

PLAIN_ES = """Tu Cuenta PRIME en PNPtv! Esta Lista

Bienvenido a PNPtv! Tu membresia PRIME esta activa.

Como Empezar:
1. Abre Telegram y busca @PNPLatinoTV_bot
2. Envia /start y completa el registro
3. Toca "Abrir App" o visita https://pnptv.app
4. Explora contenido PRIME, salas en vivo, hangouts y mas

Necesitas ayuda? Escribe a support@pnptv.app o envia /help al bot.
"""

# ── Load templates ──────────────────────────────────────────────────────────
with open("/opt/pnptvapp/emails/prime-welcome.html", "r") as f:
    HTML_EN = f.read()

with open("/opt/pnptvapp/emails/prime-welcome-es.html", "r") as f:
    HTML_ES = f.read()

# ── Get users from DB ───────────────────────────────────────────────────────
result = subprocess.run(
    [
        "docker", "exec", "pg-pnptv",
        "psql", "-U", "pnptvbot", "-d", "pnptvbot",
        "-t", "-A", "-F", "|",
        "-c", "SELECT email, language, username FROM users WHERE email IS NOT NULL AND email != '' AND tier = 'prime' ORDER BY id;"
    ],
    capture_output=True, text=True
)

users = []
for line in result.stdout.strip().split("\n"):
    if not line.strip():
        continue
    parts = line.split("|")
    if len(parts) >= 2:
        email = parts[0].strip()
        lang = parts[1].strip()
        username = parts[2].strip() if len(parts) > 2 else ""
        if email and "@" in email:
            users.append({"email": email, "lang": lang, "username": username})

print(f"Found {len(users)} PRIME members to email")
print(f"  English: {sum(1 for u in users if u['lang'] != 'es')}")
print(f"  Spanish: {sum(1 for u in users if u['lang'] == 'es')}")
print()

# ── Send emails ─────────────────────────────────────────────────────────────
context = ssl.create_default_context()
server = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=context)
server.login(SMTP_USER, SMTP_PASS)

sent = 0
failed = 0
failures = []

for i, user in enumerate(users):
    email = user["email"]
    lang = user["lang"]

    is_es = lang == "es"
    subject = SUBJECT_ES if is_es else SUBJECT_EN
    html = HTML_ES if is_es else HTML_EN
    plain = PLAIN_ES if is_es else PLAIN_EN

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{FROM_NAME} <{FROM_EMAIL}>"
    msg["To"] = email
    msg["Reply-To"] = REPLY_TO
    msg.attach(MIMEText(plain, "plain"))
    msg.attach(MIMEText(html, "html"))

    try:
        server.sendmail(FROM_EMAIL, email, msg.as_string())
        sent += 1
        tag = "ES" if is_es else "EN"
        print(f"  [{sent}/{len(users)}] [{tag}] Sent to {email}")
    except Exception as e:
        failed += 1
        failures.append({"email": email, "error": str(e)})
        print(f"  [FAIL] {email}: {e}")

    # Rate limit: ~2 emails/sec to avoid SMTP throttling
    if i < len(users) - 1:
        time.sleep(0.5)

server.quit()

print()
print(f"Done! Sent: {sent}, Failed: {failed}")
if failures:
    print("Failed emails:")
    for f in failures:
        print(f"  - {f['email']}: {f['error']}")

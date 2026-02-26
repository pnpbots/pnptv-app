#!/bin/bash

# PNPtv Bot PM2 Deployment Script
# Run this on the production server to deploy updates

set -e  # Exit on error

echo "🚀 Starting PNPtv Bot Deployment..."

# Navigate to bot directory
cd /home/user/pnptvbot-production

# Pull latest changes
echo "📥 Pulling latest changes from git..."
git fetch origin
git pull origin claude/redesign-onboarding-screens-fx9Vb

# Install/update dependencies
echo "📦 Installing dependencies..."
npm install --production

# Restart bot with PM2
echo "🔄 Restarting bot..."
if pm2 describe pnptv-bot > /dev/null 2>&1; then
    echo "Bot is running, restarting..."
    pm2 restart pnptv-bot --update-env
else
    echo "Bot is not running, starting fresh..."
    pm2 start ecosystem.config.js
fi

# Save PM2 process list
pm2 save

# Show status
echo ""
echo "✅ Deployment complete!"
echo ""
pm2 status
echo ""
echo "📊 Check logs with: pm2 logs pnptv-bot"

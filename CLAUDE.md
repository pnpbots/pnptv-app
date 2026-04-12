# Claude Project Configuration for PNPtv App

## Backend Service Architecture — SINGLE SOURCE OF TRUTH

**`apps/backend/services/`** is the ONLY services directory. NEVER create service files under `apps/backend/bot/services/` — that directory was deleted after a consolidation that removed 117 duplicate files.

### Import rules for bot code
All bot code must import services from root `services/`, adjusting the relative path based on depth:

| File location | Correct require path |
|---|---|
| `bot/core/*.js` | `require('../../services/X')` |
| `bot/api/*.js` (routes, socketHandlers) | `require('../../services/X')` |
| `bot/api/controllers/*.js` | `require('../../../services/X')` |
| `bot/api/routes/*.js` | `require('../../../services/X')` |
| `bot/api/handlers/*.js` | `require('../../../services/X')` |
| `bot/api/middleware/*.js` | `require('../../../services/X')` |
| `bot/core/middleware/*.js` | `require('../../../services/X')` |
| `bot/core/schedulers/*.js` | `require('../../../services/X')` |
| `bot/handlers/<sub>/*.js` | `require('../../../services/X')` |
| `bot/helpers/*.js` | `require('../../services/X')` |
| `bot/utils/*.js` | `require('../../services/X')` |
| `bot/middleware/*.js` | `require('../../services/X')` |
| `bot/websocket/*.js` | `require('../../services/X')` |
| `models/*.js` | `require('../services/X')` |
| `workers/*.js` | `require('../services/X')` |

### Within `services/` itself
- Use `./X` for sibling services (NOT `../services/X`)
- Use `../bot/utils/X` to reach bot utilities
- Use `../bot/core/bot` to reach the bot instance
- Use `../models/X` to reach models

## Context Ignored

The following files and directories are excluded from the context to optimize token usage and focus on relevant code.

### Excluded Directories
- `node_modules/`
- `dist/`
- `build/`
- `.next/`
- `coverage/`
- `tmp/`
- `temp/`
- `logs/`
- `.cache/`
- `public/`
- `vendor/`

### Excluded File Patterns
- `*.min.js`
- `*.min.css`
- `package-lock.json`
- `yarn.lock`
- `pnpm-lock.yaml`
- `*.svg`
- `*.png`
- `*.jpg`
- `*.jpeg`
- `*.gif`
- `*.webp`
- `*.ico`
- `*.mp4`
- `*.webm`
- `*.mov`
- `*.zip`
- `*.gz`
- `*.tar`
- `*.log`
- `*.lock`

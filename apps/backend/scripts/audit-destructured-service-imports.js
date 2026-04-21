#!/usr/bin/env node
'use strict';

/**
 * audit-destructured-service-imports.js
 *
 * Scans bot/api/routes, bot/api/controllers, and bot/api/middleware for
 * destructured requires of the form
 *
 *     const { foo, bar } = require('<path>');
 *
 * For each destructured name, loads the target module and asserts the name
 * resolves to a non-undefined value. Exits non-zero if any binding would be
 * `undefined` at runtime (a silent bug waiting to 500).
 *
 * Triggered the 2026-04-21 ePayco TOKENIZED_CHARGE_ERROR incident: a
 * `{ ensureEmailCredentials } = require('.../userService')` binding silently
 * resolved to undefined and only blew up when called during 3DS 2.0 charges.
 *
 * Usage:
 *   node apps/backend/scripts/audit-destructured-service-imports.js
 */

const fs = require('fs');
const path = require('path');

// Minimum env for modules to load without crashing at require-time.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'audit-session-secret-padding-padding';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'audit-jwt-secret-padding-padding';

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = [
  path.join(ROOT, 'bot', 'api', 'routes'),
  path.join(ROOT, 'bot', 'api', 'controllers'),
  path.join(ROOT, 'bot', 'api', 'middleware'),
];

const DESTRUCTURE_RE = /const\s*\{\s*([^}]+)\s*\}\s*=\s*require\(\s*['"`]([^'"`]+)['"`]\s*\)/g;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.isFile() && p.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => walk(d));
const failures = [];
let checked = 0;

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  let m;
  DESTRUCTURE_RE.lastIndex = 0;
  while ((m = DESTRUCTURE_RE.exec(src)) !== null) {
    const names = m[1]
      .split(',')
      .map((s) => s.trim())
      .map((s) => s.split(':')[0].trim()) // handle `{ foo: bar }` alias form
      .filter((s) => s && /^[A-Za-z_$][\w$]*$/.test(s));
    const target = m[2];
    if (!target.startsWith('.') && !target.startsWith('/')) continue; // skip node_modules

    let resolved;
    try {
      resolved = require.resolve(target, { paths: [path.dirname(file)] });
    } catch (err) {
      failures.push({ file, target, names, error: `cannot resolve: ${err.message}` });
      continue;
    }

    let mod;
    try {
      mod = require(resolved);
    } catch (err) {
      failures.push({ file, target, names, error: `load failed: ${err.message}` });
      continue;
    }

    for (const name of names) {
      checked++;
      if (mod == null || typeof mod[name] === 'undefined') {
        failures.push({
          file: path.relative(ROOT, file),
          target,
          name,
          error: `binding '${name}' is undefined in module`,
        });
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`\n✖ ${failures.length} undefined destructured binding(s) (out of ${checked} checked):\n`);
  for (const f of failures) {
    console.error(`  ${f.file}`);
    console.error(`    require('${f.target}') → ${f.name || f.names?.join(', ')}`);
    console.error(`    ${f.error}\n`);
  }
  process.exit(1);
}

console.log(`✓ All ${checked} destructured service bindings across ${files.length} files resolve to defined values.`);
process.exit(0);

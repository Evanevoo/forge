'use strict';
/**
 * Licensing: offline, self-issued keys.
 *
 * A key is a signed statement — "this person bought Forge" — signed with an
 * Ed25519 private key that only the vendor holds. Forge verifies it with the
 * public key embedded below. That means:
 *
 *   · no licence server, so activation can't be down
 *   · no account, no login, nothing to store about the customer
 *   · works with the machine offline, which matters because offline builds
 *     are the entire point of this product
 *   · nobody can mint a key without the private key
 *
 * What it deliberately does NOT do is stop a determined person from patching
 * the binary. Nothing client-side can. The job here is to make buying the
 * obvious path for honest people, not to win an arms race.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** Public half of the vendor signing key. Replace via tools/mint-license.js --keygen. */
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAMiOj8B6LMFP8/DAqb5x6xngpggMLLlOWuV57PFbL6Wg=
-----END PUBLIC KEY-----`;

const KEY_PREFIX = 'FORGE-1';
/** Successful builds allowed before a licence is required. */
const TRIAL_BUILDS = 2;

let app = null;
try { ({ app } = require('electron')); } catch (_) { /* testable outside Electron */ }

function dataDir() {
  return app ? app.getPath('userData') : path.join(process.cwd(), '.forge-data');
}
function stateFile() {
  return path.join(dataDir(), 'license.json');
}

/* ----------------------------------------------------------- key format -- */

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(str) {
  return Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Build the signed key string. Used by the minting CLI; kept here so the
 * format has exactly one definition that both sides share.
 */
function formatKey(payloadObj, signature) {
  return [KEY_PREFIX, b64url(JSON.stringify(payloadObj)), b64url(signature)].join('.');
}

/**
 * Terminals wrap long lines and mail clients insert breaks; a key copied out
 * of either arrives with newlines and spaces through the middle of it. That is
 * not the customer's mistake to pay for, so strip whitespace before parsing.
 */
function normalizeKey(key) {
  return String(key).replace(/\s+/g, '');
}

/**
 * "That doesn't look like a key" is a useless thing to tell someone who has
 * just pasted something. Say what they actually pasted instead.
 */
function describeNotAKey(cleaned, parts) {
  if (/BEGIN(RSA|EC|ED25519)?PRIVATEKEY/i.test(cleaned)) {
    return 'That is your private signing key — it never leaves your machine and is not a licence key. Mint one with:  npm run license -- --name "Your Name"';
  }
  if (/BEGINPUBLICKEY/i.test(cleaned)) {
    return 'That is the vendor public key from src/license.js, not a licence key. Mint one with:  npm run license -- --name "Your Name"';
  }
  if (cleaned.includes('…') || cleaned.includes('...')) {
    return 'That key is abbreviated — it still contains "...". Copy the whole line the minting tool printed, from FORGE-1 to the very end.';
  }
  if (parts[0] === KEY_PREFIX && parts.length < 3) {
    return 'That key is cut short — Forge keys have three dot-separated parts and this has ' + parts.length + '. Copy the whole line, it is about 300 characters.';
  }
  if (parts[0] === KEY_PREFIX) {
    return 'That key has ' + parts.length + ' dot-separated parts; a Forge key has exactly three. Something extra came along with the paste.';
  }
  return 'A Forge licence key starts with "' + KEY_PREFIX + '." and has three dot-separated parts. This starts with "'
    + cleaned.slice(0, 12) + (cleaned.length > 12 ? '…' : '') + '". Run  npm run license -- --name "Your Name"  to mint one.';
}

/**
 * @returns {{valid: boolean, reason?: string, payload?: object}}
 */
function verifyKey(key, publicKeyPem = PUBLIC_KEY_PEM) {
  if (typeof key !== 'string' || !key.trim()) {
    return { valid: false, reason: 'No licence key entered.' };
  }
  const cleaned = normalizeKey(key);
  const parts = cleaned.split('.');
  if (parts.length !== 3 || parts[0] !== KEY_PREFIX) {
    return { valid: false, reason: describeNotAKey(cleaned, parts) };
  }
  let payload;
  let signature;
  try {
    payload = JSON.parse(unb64url(parts[1]).toString('utf8'));
    signature = unb64url(parts[2]);
  } catch (_) {
    return { valid: false, reason: 'The licence key is damaged — check it copied in full.' };
  }
  let ok = false;
  try {
    ok = crypto.verify(null, Buffer.from(parts[1], 'utf8'), publicKeyPem, signature);
  } catch (err) {
    return { valid: false, reason: 'The licence key could not be checked.' };
  }
  if (!ok) return { valid: false, reason: 'This licence key is not genuine.' };

  if (payload.exp && Date.now() > Number(payload.exp)) {
    return { valid: false, reason: 'This licence key has expired.' };
  }
  return { valid: true, payload };
}

/* ---------------------------------------------------------------- state -- */

function readState() {
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    return {
      key: typeof raw.key === 'string' ? raw.key : null,
      trialBuilds: Number.isFinite(raw.trialBuilds) ? raw.trialBuilds : 0,
      activatedAt: raw.activatedAt || null,
    };
  } catch (_) {
    return { key: null, trialBuilds: 0, activatedAt: null };
  }
}

function writeState(next) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
  return next;
}

/* --------------------------------------------------------------- public -- */

function status() {
  const state = readState();
  const check = state.key ? module.exports.verifyKey(state.key) : null;

  if (check && check.valid) {
    return {
      licensed: true,
      licensedTo: check.payload.name || check.payload.email || 'licensed user',
      email: check.payload.email || null,
      issuedAt: check.payload.iat || null,
      trialBuilds: state.trialBuilds,
      trialTotal: TRIAL_BUILDS,
      trialRemaining: 0,
      message: 'Licensed to ' + (check.payload.name || check.payload.email || 'you') + '.',
    };
  }

  const remaining = Math.max(0, TRIAL_BUILDS - state.trialBuilds);
  return {
    licensed: false,
    invalidStoredKey: !!(check && !check.valid),
    storedKeyReason: check && !check.valid ? check.reason : null,
    trialBuilds: state.trialBuilds,
    trialTotal: TRIAL_BUILDS,
    trialRemaining: remaining,
    message: remaining > 0
      ? remaining + ' of ' + TRIAL_BUILDS + ' trial build' + (TRIAL_BUILDS === 1 ? '' : 's') + ' remaining'
      : 'Trial finished — a licence key is needed to build.',
  };
}

/** Gate consulted before a build starts. */
function canBuild() {
  const s = status();
  if (s.licensed) return { allowed: true, licensed: true };
  if (s.trialRemaining > 0) {
    return { allowed: true, licensed: false, trialRemaining: s.trialRemaining };
  }
  return {
    allowed: false,
    licensed: false,
    trialRemaining: 0,
    reason: 'Your ' + TRIAL_BUILDS + ' trial builds are used up. Enter a licence key to keep building.',
  };
}

/**
 * Only *successful* builds consume the trial — a build that died on a missing
 * JDK taught the customer nothing and shouldn't cost them anything.
 */
function recordSuccessfulBuild() {
  const s = readState();
  if (s.key && module.exports.verifyKey(s.key).valid) return status();
  writeState({ ...s, trialBuilds: s.trialBuilds + 1 });
  return status();
}

function activate(key) {
  const check = module.exports.verifyKey(key);
  if (!check.valid) {
    const err = new Error(check.reason);
    err.expected = true;
    throw err;
  }
  const s = readState();
  writeState({ ...s, key: normalizeKey(key), activatedAt: new Date().toISOString() });
  return status();
}

function clear() {
  const s = readState();
  writeState({ ...s, key: null, activatedAt: null });
  return status();
}

module.exports = {
  verifyKey,
  formatKey,
  normalizeKey,
  status,
  canBuild,
  recordSuccessfulBuild,
  activate,
  clear,
  TRIAL_BUILDS,
  KEY_PREFIX,
  PUBLIC_KEY_PEM,
  _paths: { dataDir, stateFile },
};

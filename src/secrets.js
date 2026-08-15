'use strict';
/**
 * Persistent state for Forge.
 *
 *  settings.json   — non-secret preferences (last project, tool overrides…)
 *  keystores.json  — keystore records. Passwords are encrypted with Electron's
 *                    safeStorage (DPAPI on Windows) and stored base64. Nothing
 *                    readable is ever written to disk.
 *
 * If safeStorage reports encryption is unavailable, Forge refuses to persist
 * passwords at all and keeps them in memory for the session instead — it never
 * silently falls back to plaintext.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let app = null;
let safeStorage = null;
try {
  ({ app, safeStorage } = require('electron'));
} catch (_) {
  // Allows the module to be unit-tested outside Electron.
}

let baseDir = null;
function dir() {
  if (baseDir) return baseDir;
  baseDir = app ? app.getPath('userData') : path.join(process.cwd(), '.forge-data');
  fs.mkdirSync(baseDir, { recursive: true });
  return baseDir;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
}

const settingsFile = () => path.join(dir(), 'settings.json');
const keystoreFile = () => path.join(dir(), 'keystores.json');

/* ------------------------------------------------------------- settings -- */

const DEFAULT_SETTINGS = {
  lastProject: null,
  jdkOverride: null,
  sdkOverride: null,
  selectedKeystoreId: null,
  buildTarget: 'bundle',
  // Local release builds shouldn't fail because a crash reporter wants a
  // cloud auth token. Off by default; the Build card exposes the switch.
  skipSymbolUploads: true,
  playServiceAccount: null,
  playTrack: 'internal',
};

function getSettings() {
  return { ...DEFAULT_SETTINGS, ...readJson(settingsFile(), {}) };
}
function setSettings(patch) {
  const next = { ...getSettings(), ...patch };
  writeJson(settingsFile(), next);
  return next;
}

/* ------------------------------------------------------------ encryption -- */

function encryptionAvailable() {
  try {
    return !!(safeStorage && safeStorage.isEncryptionAvailable());
  } catch (_) {
    return false;
  }
}

function encrypt(plain) {
  if (plain == null || plain === '') return null;
  if (!encryptionAvailable()) return null;
  return safeStorage.encryptString(String(plain)).toString('base64');
}

function decrypt(b64) {
  if (!b64) return null;
  if (!encryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(b64, 'base64'));
  } catch (_) {
    return null;
  }
}

/* --------------------------------------------------- named secret store -- */

/**
 * Somewhere to keep single values that aren't keystore passwords — a GitHub
 * token, the iOS certificate password. Same rule as everywhere else: encrypted
 * by the OS keystore, or held in memory for the session, never plaintext.
 */
const secretsFile = () => path.join(dir(), 'secrets.json');
const sessionNamed = new Map();

function setSecret(name, value) {
  const all = readJson(secretsFile(), {});
  if (value == null || value === '') {
    delete all[name];
    sessionNamed.delete(name);
    writeJson(secretsFile(), all);
    return { stored: false, cleared: true };
  }
  const enc = encrypt(value);
  if (enc) {
    all[name] = enc;
    writeJson(secretsFile(), all);
    sessionNamed.delete(name);
    return { stored: true, encrypted: true };
  }
  sessionNamed.set(name, String(value));
  return { stored: true, encrypted: false, sessionOnly: true };
}

function getSecret(name) {
  if (sessionNamed.has(name)) return sessionNamed.get(name);
  const all = readJson(secretsFile(), {});
  return all[name] ? decrypt(all[name]) : null;
}

function hasSecret(name) {
  return sessionNamed.has(name) || !!readJson(secretsFile(), {})[name];
}

/* ------------------------------------------------------------ keystores -- */

/** In-memory only, used when safeStorage is unavailable. */
const sessionSecrets = new Map();

function listKeystores() {
  const records = readJson(keystoreFile(), []);
  return records.map((r) => ({
    id: r.id,
    label: r.label,
    path: r.path,
    alias: r.alias,
    sha1: r.sha1 || null,
    sha256: r.sha256 || null,
    validUntil: r.validUntil || null,
    addedAt: r.addedAt,
    origin: r.origin || 'imported',
    missing: !fs.existsSync(r.path),
    hasStoredPassword: !!(r.enc && r.enc.store) || sessionSecrets.has(r.id),
  }));
}

function saveKeystore(rec, secrets) {
  const records = readJson(keystoreFile(), []);
  const id = rec.id || crypto.randomUUID();
  const encrypted = encryptionAvailable()
    ? { store: encrypt(secrets.storePassword), key: encrypt(secrets.keyPassword) }
    : null;
  if (!encrypted) {
    sessionSecrets.set(id, { ...secrets });
  }
  const entry = {
    id,
    label: rec.label,
    path: rec.path,
    alias: rec.alias,
    sha1: rec.sha1 || null,
    sha256: rec.sha256 || null,
    validUntil: rec.validUntil || null,
    origin: rec.origin || 'imported',
    addedAt: rec.addedAt || new Date().toISOString(),
    enc: encrypted,
  };
  const idx = records.findIndex((r) => r.id === id);
  if (idx >= 0) records[idx] = entry; else records.push(entry);
  writeJson(keystoreFile(), records);
  return { ...entry, enc: undefined, id };
}

function removeKeystore(id) {
  const records = readJson(keystoreFile(), []).filter((r) => r.id !== id);
  writeJson(keystoreFile(), records);
  sessionSecrets.delete(id);
  const s = getSettings();
  if (s.selectedKeystoreId === id) setSettings({ selectedKeystoreId: null });
  return true;
}

/**
 * Resolve the credentials for a keystore.
 * @returns {{path,alias,storePassword,keyPassword}|null} null if unavailable.
 */
function getKeystoreSecrets(id) {
  const rec = readJson(keystoreFile(), []).find((r) => r.id === id);
  if (!rec) return null;
  if (rec.enc && rec.enc.store) {
    const storePassword = decrypt(rec.enc.store);
    if (storePassword == null) return null;
    const keyPassword = rec.enc.key ? decrypt(rec.enc.key) : storePassword;
    return { path: rec.path, alias: rec.alias, storePassword, keyPassword: keyPassword || storePassword };
  }
  if (sessionSecrets.has(id)) {
    const s = sessionSecrets.get(id);
    return { path: rec.path, alias: rec.alias, storePassword: s.storePassword, keyPassword: s.keyPassword || s.storePassword };
  }
  return null;
}

function rememberSessionSecrets(id, secrets) {
  sessionSecrets.set(id, { ...secrets });
}

module.exports = {
  getSettings,
  setSettings,
  setSecret,
  getSecret,
  hasSecret,
  listKeystores,
  saveKeystore,
  removeKeystore,
  getKeystoreSecrets,
  rememberSessionSecrets,
  encryptionAvailable,
  paths: { dir, settingsFile, keystoreFile },
};

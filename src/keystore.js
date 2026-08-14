'use strict';
/**
 * Keystore management via the JDK's own `keytool`.
 *
 * Two flows:
 *   generate()  — create a brand-new upload key (for a NEW app).
 *   inspect()   — validate an existing .jks/.keystore, list its aliases and
 *                 read back the SHA-1/SHA-256 fingerprints so you can confirm
 *                 the key matches what Google Play expects before you build.
 *
 * Note on passwords and argv: keytool takes -storepass/-keypass as arguments.
 * On a single-user desktop this is visible only to the same user's own process
 * list, and it is by far the most reliable way to drive keytool
 * non-interactively. Passwords are never written to disk in plaintext.
 */
const fs = require('fs');
const path = require('path');
const { run } = require('./exec');

function keytoolOf(jdk) {
  if (!jdk || !jdk.keytoolExe) throw new Error('No JDK available — keytool comes with the JDK.');
  return jdk.keytoolExe;
}

function parseFingerprints(text) {
  const out = { sha1: null, sha256: null, validUntil: null, alias: null, algorithm: null };
  const sha1 = /SHA1:\s*([0-9A-F:]{20,})/i.exec(text);
  const sha256 = /SHA256:\s*([0-9A-F:]{40,})/i.exec(text);
  const until = /Valid from:.*?until:\s*(.+)$/im.exec(text);
  const alias = /Alias name:\s*(.+)$/im.exec(text);
  const algo = /Signature algorithm name:\s*(.+)$/im.exec(text);
  if (sha1) out.sha1 = sha1[1].trim().toUpperCase();
  if (sha256) out.sha256 = sha256[1].trim().toUpperCase();
  if (until) out.validUntil = until[1].trim();
  if (alias) out.alias = alias[1].trim();
  if (algo) out.algorithm = algo[1].trim();
  return out;
}

function parseAliases(text) {
  const aliases = [];
  const re = /^(.+?),\s+.*?,\s*(?:PrivateKeyEntry|trustedCertEntry)/gim;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1].trim();
    if (name && !aliases.includes(name)) aliases.push(name);
  }
  if (!aliases.length) {
    const re2 = /^Alias name:\s*(.+)$/gim;
    while ((m = re2.exec(text))) {
      const name = m[1].trim();
      if (name && !aliases.includes(name)) aliases.push(name);
    }
  }
  return aliases;
}

function friendlyKeytoolError(text) {
  const t = text || '';
  if (/password was incorrect|Keystore was tampered with, or password was incorrect/i.test(t)) {
    return 'Wrong keystore password (or the file is corrupt).';
  }
  if (/Alias .* does not exist/i.test(t)) return 'That alias does not exist in this keystore.';
  if (/Cannot recover key/i.test(t)) return 'Wrong key password for that alias.';
  if (/NoSuchFileException|no such file/i.test(t)) return 'Keystore file not found.';
  const first = t.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
  return first || 'keytool failed.';
}

/** Read a keystore's contents. Requires the store password. */
async function inspect({ jdk, file, storePassword, alias }) {
  if (!fs.existsSync(file)) throw new Error('Keystore file not found: ' + file);
  const args = ['-list', '-v', '-keystore', file, '-storepass', storePassword];
  if (alias) args.push('-alias', alias);
  const res = await run({ file: keytoolOf(jdk), args, timeout: 60000 });
  const text = (res.stdout || '') + (res.stderr || '');
  if (res.code !== 0) {
    const err = new Error(friendlyKeytoolError(text));
    err.raw = text;
    throw err;
  }
  const aliases = parseAliases(text);
  const fp = parseFingerprints(text);
  return {
    file,
    aliases,
    alias: alias || fp.alias || aliases[0] || null,
    sha1: fp.sha1,
    sha256: fp.sha256,
    validUntil: fp.validUntil,
    algorithm: fp.algorithm,
    raw: text,
  };
}

/**
 * Verify the *key* password, which is separate from the keystore password and
 * is frequently different.
 *
 * `keytool -list` only proves the store password, so a wrong key password
 * survives import and then fails at the very last Gradle task with
 * "Cannot recover key" — after the entire app has compiled.
 *
 * `-certreq` needs the private key, so it fails on a bad key password, and it
 * only writes a CSR to stdout: the keystore file is never modified. (Don't use
 * `-keypasswd` for this — it rewrites the keystore.)
 */
async function verifyKeyPassword({ jdk, file, storePassword, alias, keyPassword }) {
  const res = await run({
    file: keytoolOf(jdk),
    args: ['-certreq', '-keystore', file, '-alias', alias,
      '-storepass', storePassword, '-keypass', keyPassword],
    timeout: 60000,
  });
  const text = (res.stdout || '') + (res.stderr || '');
  if (res.code !== 0) {
    return { ok: false, message: friendlyKeytoolError(text) };
  }
  return { ok: true };
}

/**
 * Generate a new keystore.
 * Only for apps that have never been published — a new key will NOT match an
 * app already on Google Play.
 */
async function generate({ jdk, file, alias, storePassword, keyPassword, dname, validityDays = 10950, keySize = 2048 }) {
  if (fs.existsSync(file)) throw new Error('A file already exists at ' + file + ' — choose a different name.');
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const res = await run({
    file: keytoolOf(jdk),
    args: [
      '-genkeypair', '-v',
      '-keystore', file,
      '-alias', alias,
      '-keyalg', 'RSA',
      '-keysize', String(keySize),
      '-validity', String(validityDays),
      '-storetype', 'JKS',
      '-dname', dname,
      '-storepass', storePassword,
      '-keypass', keyPassword || storePassword,
    ],
    timeout: 180000,
  });
  const text = (res.stdout || '') + (res.stderr || '');
  if (res.code !== 0) {
    const err = new Error(friendlyKeytoolError(text));
    err.raw = text;
    throw err;
  }
  const info = await inspect({ jdk, file, storePassword, alias });
  return { ...info, raw: text + '\n' + info.raw };
}

function buildDname({ commonName, organizationalUnit, organization, locality, state, country }) {
  const parts = [
    ['CN', commonName],
    ['OU', organizationalUnit],
    ['O', organization],
    ['L', locality],
    ['ST', state],
    ['C', country],
  ].filter(([, v]) => v && String(v).trim().length);
  if (!parts.length) throw new Error('At least a common name (CN) is required.');
  return parts.map(([k, v]) => k + '=' + String(v).replace(/([,\\+"<>;])/g, '\\$1').trim()).join(', ');
}

module.exports = {
  inspect,
  generate,
  verifyKeyPassword,
  buildDname,
  parseFingerprints,
  parseAliases,
  friendlyKeytoolError,
};

#!/usr/bin/env node
'use strict';
/**
 * Forge licence minting — the vendor-side tool. This is your "admin panel".
 *
 * First time only:
 *   node tools/mint-license.js --keygen
 *     Creates a signing key pair. The PRIVATE key is written outside this
 *     folder so it can never be committed; the PUBLIC key is printed for you
 *     to paste into src/license.js. Back the private key up — losing it means
 *     you can never issue another key that existing installs accept.
 *
 * For each sale:
 *   node tools/mint-license.js --name "Jane Smith" --email jane@example.com
 *     Prints the licence key. Email it to the customer.
 *
 * Optional:
 *   --expires 2027-01-01     time-limited key (default: never expires)
 *   --note "e-transfer #123" recorded in the key and in the sales log
 *   --key <path>             private key location (default ~/.forge-signing/private.pem)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { formatKey, verifyKey } = require('../src/license');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const keyDir = args.key ? path.dirname(args.key) : path.join(os.homedir(), '.forge-signing');
const privatePath = args.key || path.join(keyDir, 'private.pem');
const salesLog = path.join(keyDir, 'sales.jsonl');

function die(msg) {
  console.error('\n  ' + msg + '\n');
  process.exit(1);
}

/* ------------------------------------------------------- public key I/O -- */

const licenseSrc = path.join(__dirname, '..', 'src', 'license.js');
const publicPath = path.join(keyDir, 'public.pem');

/**
 * Write the vendor public key into src/license.js.
 *
 * This has to be re-runnable, because src/license.js is a source file: any
 * time the source tree is replaced — an update, a fresh clone, a re-extracted
 * zip — the placeholder key comes back and every licence stops verifying.
 * Re-deriving the public half from the private key is safe and idempotent.
 *
 * @returns {boolean} whether the file was changed
 */
function writePublicKey(pubPem) {
  const before = fs.readFileSync(licenseSrc, 'utf8');
  const after = before.replace(/const PUBLIC_KEY_PEM = `[^`]*`;/,
    'const PUBLIC_KEY_PEM = `' + pubPem + '`;');
  if (after === before && !before.includes(pubPem)) {
    console.log('  Could not find PUBLIC_KEY_PEM in src/license.js — paste it in yourself:\n');
    console.log(pubPem.split('\n').map((l) => '    ' + l).join('\n') + '\n');
    return false;
  }
  if (after === before) {
    console.log('\n  src/license.js already carries this public key. Nothing to do.\n');
    return false;
  }
  fs.writeFileSync(licenseSrc + '.bak', before);
  fs.writeFileSync(licenseSrc, after, 'utf8');
  return true;
}

function publicFromPrivate() {
  const priv = crypto.createPrivateKey(fs.readFileSync(privatePath));
  return crypto.createPublicKey(priv).export({ type: 'spki', format: 'pem' }).toString().trim();
}

/* ---------------------------------------------------------- publish-key -- */

if (args['publish-key']) {
  if (!fs.existsSync(privatePath)) {
    die('No signing key at ' + privatePath + '\n  Run:  npm run license -- --keygen');
  }
  const pubPem = publicFromPrivate();
  fs.writeFileSync(publicPath, pubPem + '\n');
  if (writePublicKey(pubPem)) {
    console.log('\n  src/license.js now carries your public key  (previous copy: src/license.js.bak)');
    console.log('  Every licence you have already issued verifies again — no need to re-mint.');
    console.log('  Restart Forge, and run  npm run dist  so the .exe carries it too.\n');
  }
  process.exit(0);
}

/* --------------------------------------------------------------- keygen -- */

if (args.keygen) {
  if (fs.existsSync(privatePath) && !args.force) {
    die('A signing key already exists at ' + privatePath + '\n  Refusing to overwrite it — every licence you have ever issued depends on it.\n  Use --force only if you are certain.');
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(keyDir, { recursive: true });
  fs.writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString().trim();

  fs.writeFileSync(publicPath, pubPem + '\n');

  console.log('\n  Private key written to ' + privatePath);
  console.log('  Back this up somewhere safe and offline. Never commit it.\n');

  // Paste it in for them. Hand-editing a PEM into a template literal is a
  // pointless place to lose ten minutes to a stray newline.
  if (args['no-write']) {
    console.log('  Paste this into PUBLIC_KEY_PEM in src/license.js:\n');
    console.log(pubPem.split('\n').map((l) => '    ' + l).join('\n'));
  } else if (writePublicKey(pubPem)) {
    console.log('  Public key written into src/license.js  (previous copy: src/license.js.bak)');
    console.log('  Restart Forge, and rebuild the .exe, so both carry the new key.\n');
  }
  console.log('  Do this once. Changing it later invalidates every licence you have issued.\n');
  process.exit(0);
}

/* ----------------------------------------------------------------- mint -- */

if (!args.name && !args.email) {
  die('Usage:\n    node tools/mint-license.js --keygen\n    node tools/mint-license.js --name "Jane Smith" --email jane@example.com [--expires 2027-01-01] [--note "e-transfer ref"]');
}
if (!fs.existsSync(privatePath)) {
  die('No signing key at ' + privatePath + '\n  Run:  node tools/mint-license.js --keygen');
}

const payload = {
  v: 1,
  name: args.name || null,
  email: args.email || null,
  iat: Date.now(),
  id: crypto.randomUUID(),
};
if (args.note && args.note !== true) payload.note = String(args.note);
if (args.expires && args.expires !== true) {
  const t = Date.parse(args.expires);
  if (Number.isNaN(t)) die('Could not read --expires "' + args.expires + '". Use YYYY-MM-DD.');
  payload.exp = t;
}

const privateKey = crypto.createPrivateKey(fs.readFileSync(privatePath));
const signature = crypto.sign(null, Buffer.from(
  Buffer.from(JSON.stringify(payload)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), 'utf8'), privateKey);

const licenceKey = formatKey(payload, signature);

// Prove it verifies against the public key currently compiled into the app,
// so a mismatched key pair is caught here rather than by a paying customer.
const check = verifyKey(licenceKey);

fs.mkdirSync(keyDir, { recursive: true });
fs.appendFileSync(salesLog, JSON.stringify({ ...payload, key: licenceKey, mintedAt: new Date().toISOString() }) + '\n');

console.log('\n  Licence key for ' + (payload.name || payload.email) + ':\n');
console.log('    ' + licenceKey + '\n');
console.log('  Recorded in ' + salesLog);
if (!check.valid) {
  console.log('\n  ⚠ This key does NOT verify against the public key in src/license.js');
  console.log('    (' + check.reason + ')');
  // Almost always this means the source tree was replaced since --keygen and
  // took the placeholder public key with it. Re-deriving fixes it in one step,
  // and the key printed above stays valid.
  const { PUBLIC_KEY_PEM } = require('../src/license');
  if (publicFromPrivate() !== PUBLIC_KEY_PEM.trim()) {
    console.log('\n    src/license.js is carrying a different public key to your signing key.');
    console.log('    That happens when the source folder is replaced by an update.');
    console.log('\n      Fix it with:  npm run license -- --publish-key');
    console.log('\n    Your signing key is untouched, and the key above will verify afterwards.\n');
  }
} else {
  console.log('  Verified against the public key in src/license.js — safe to send.\n');
}

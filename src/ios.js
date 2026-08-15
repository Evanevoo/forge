'use strict';
/**
 * iOS: signing credentials on Windows, and driving the macOS CI runner.
 *
 * Windows cannot compile an iOS app — that needs Xcode. What it *can* do is
 * everything either side of the compile: create the signing identity, hold the
 * credentials, start the build on a rented Mac, and collect the .ipa. That is
 * the whole of Expo's iOS offering minus the part Apple licences to macOS.
 *
 * The certificate flow deserves an explanation, because the usual advice is
 * "use Keychain Access on a Mac" and that is not an option here.
 *
 * An Apple signing certificate is just an RSA key pair where Apple has signed
 * the public half. Keychain's "Request a Certificate From a Certificate
 * Authority" produces a PKCS#10 CSR; so does `keytool -certreq`, which ships
 * with the JDK Forge already requires for Android. So:
 *
 *   1. keytool generates the key pair and a CSR                 (here)
 *   2. you upload the CSR at developer.apple.com and get a .cer (browser)
 *   3. keytool imports Apple's reply on top of the private key  (here)
 *   4. keytool exports the pair as a .p12 the Mac runner imports(here)
 *
 * Step 3 needs Apple's intermediate and root certificates present first, or
 * keytool refuses the reply with "Failed to establish chain from reply" — so
 * Forge fetches them from apple.com rather than making that your problem.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { run } = require('./exec');

/** Where signing material lives. Outside the project, so prebuild can't wipe it. */
function credentialsDir() {
  return path.join(os.homedir(), '.forge-ios');
}

/* ------------------------------------------------------------ app.json -- */

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

/**
 * The iOS bundle identifier. Unlike Android's applicationId this has no
 * fallback — if app.json doesn't declare it, `expo prebuild` on the runner
 * fails, twenty minutes into a paid macOS job. Worth checking before then.
 */
function bundleId(dir) {
  const cfg = readJsonSafe(path.join(dir, 'app.json'));
  return (cfg && cfg.expo && cfg.expo.ios && cfg.expo.ios.bundleIdentifier) || null;
}

function setBundleId(dir, id) {
  if (!/^[A-Za-z0-9.-]+$/.test(String(id || '')) || !String(id).includes('.')) {
    throw new Error('A bundle identifier looks like com.company.app — letters, digits, dots and hyphens only.');
  }
  const file = path.join(dir, 'app.json');
  const cfg = readJsonSafe(file);
  if (!cfg || !cfg.expo) throw new Error('No app.json with an "expo" block here — set the bundle id in Xcode instead.');
  cfg.expo.ios = { ...(cfg.expo.ios || {}), bundleIdentifier: String(id) };
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  return { ok: true, path: file, bundleId: String(id) };
}

/* ---------------------------------------------------------- git remote -- */

/**
 * Pull owner/repo out of a git remote URL. Handles both forms git uses:
 *   https://github.com/owner/repo.git
 *   git@github.com:owner/repo.git
 */
function parseRemoteUrl(url) {
  if (!url) return null;
  const m = /github\.com[:/]+([^/]+)\/([^/\s]+?)(?:\.git)?\s*$/i.exec(String(url).trim());
  return m ? { owner: m[1], repo: m[2] } : null;
}

/** Read .git/config directly — cheaper and more predictable than shelling out. */
function repoFromDir(dir) {
  const cfg = path.join(dir, '.git', 'config');
  let text;
  try { text = fs.readFileSync(cfg, 'utf8'); } catch (_) { return null; }
  // Prefer origin; fall back to the first GitHub remote of any name.
  const blocks = text.split(/\[remote\s+"/).slice(1);
  const remotes = blocks.map((b) => {
    const name = b.slice(0, b.indexOf('"'));
    const m = /url\s*=\s*(.+)/.exec(b);
    return { name, url: m ? m[1].trim() : null };
  });
  const pick = remotes.find((r) => r.name === 'origin' && parseRemoteUrl(r.url))
    || remotes.find((r) => parseRemoteUrl(r.url));
  if (!pick) return null;
  return { ...parseRemoteUrl(pick.url), remote: pick.name, url: pick.url };
}

/* ------------------------------------------------------------ download -- */

/** GET a URL to a file, following redirects. Used for Apple's CA certs and CI artifacts. */
function download(url, dest, headers = {}, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('Too many redirects fetching ' + url));
    https.get(url, { headers: { 'user-agent': 'Forge', ...headers } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        // Redirects to signed storage URLs must NOT carry the Authorization
        // header — S3 rejects a request that is signed twice.
        const onward = { ...headers };
        delete onward.authorization;
        return resolve(download(res.headers.location, dest, onward, depth + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' fetching ' + url));
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve(dest)));
      out.on('error', reject);
    }).on('error', reject);
  });
}

/* --------------------------------------------------------- certificate -- */

/**
 * Apple's chain, as published at apple.com/certificateauthority.
 * Both are needed: keytool validates a certificate reply all the way to a
 * self-signed root before it will attach it to your private key.
 */
const APPLE_CA = [
  { alias: 'apple-root-g3', url: 'https://www.apple.com/certificateauthority/AppleRootCA-G3.cer' },
  { alias: 'apple-wwdr-g3', url: 'https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer' },
];

const KEY_ALIAS = 'ios-distribution';

function paths() {
  const d = credentialsDir();
  return {
    dir: d,
    keystore: path.join(d, 'ios-signing.p12'),
    csr: path.join(d, 'ios-distribution.csr'),
    p12: path.join(d, 'ios-distribution.p12'),
    profile: path.join(d, 'profile.mobileprovision'),
    ascKey: path.join(d, 'AuthKey.p8'),
  };
}

function status() {
  const p = paths();
  return {
    dir: p.dir,
    hasKey: fs.existsSync(p.keystore),
    hasCsr: fs.existsSync(p.csr),
    hasP12: fs.existsSync(p.p12),
    hasProfile: fs.existsSync(p.profile),
    hasAscKey: fs.existsSync(p.ascKey),
    csrPath: p.csr,
    p12Path: p.p12,
    profilePath: p.profile,
  };
}

function requireKeytool(keytool) {
  if (!keytool) throw new Error('keytool was not found. Set the JDK folder in Prerequisites first.');
}

/**
 * Step 1 — key pair + CSR. The CSR is what you upload to Apple.
 *
 * The distinguished name is cosmetic: Apple issues the certificate against
 * your developer account, not against what the CSR claims. It still has to be
 * present and well-formed.
 */
async function createCsr({ keytool, name, email, country = 'US', password, force = false }) {
  requireKeytool(keytool);
  if (!password || String(password).length < 6) {
    throw new Error('Choose a password of at least 6 characters. You will paste it into GitHub as IOS_CERT_PASSWORD.');
  }
  const p = paths();
  if (fs.existsSync(p.keystore) && !force) {
    throw new Error('A signing key already exists in ' + p.dir + '.\n'
      + 'Replacing it invalidates the certificate Apple issued against it. Tick "replace" only if you mean to start over.');
  }
  fs.mkdirSync(p.dir, { recursive: true });
  if (force) for (const f of [p.keystore, p.csr, p.p12]) { try { fs.unlinkSync(f); } catch (_) { /* fine */ } }

  const dnParts = ['CN=' + sanitizeDn(name || 'Forge User')];
  if (email) dnParts.push('EMAILADDRESS=' + sanitizeDn(email));
  dnParts.push('O=' + sanitizeDn(name || 'Forge User'));
  dnParts.push('C=' + sanitizeDn(String(country).toUpperCase().slice(0, 2) || 'US'));

  const gen = await run({
    file: keytool,
    args: ['-genkeypair', '-alias', KEY_ALIAS, '-keyalg', 'RSA', '-keysize', '2048',
      '-validity', '3650', '-dname', dnParts.join(', '),
      '-keystore', p.keystore, '-storetype', 'PKCS12',
      '-storepass', password, '-keypass', password],
  });
  if (gen.code !== 0) throw new Error('keytool could not create the key pair:\n' + tail(gen));

  const req = await run({
    file: keytool,
    args: ['-certreq', '-alias', KEY_ALIAS, '-file', p.csr,
      '-keystore', p.keystore, '-storepass', password, '-keypass', password],
  });
  if (req.code !== 0) throw new Error('keytool could not create the request:\n' + tail(req));

  return { ok: true, csr: p.csr, keystore: p.keystore };
}

/** keytool's -dname parser treats these as separators. */
function sanitizeDn(value) {
  return String(value).replace(/[,+="<>#;\\]/g, ' ').replace(/\s+/g, ' ').trim() || 'Forge User';
}

function tail(result, lines = 6) {
  return String((result.stderr || '') + (result.stdout || ''))
    .split('\n').filter((l) => l.trim() && !/JAVA_TOOL_OPTIONS/.test(l)).slice(-lines).join('\n');
}

/**
 * Step 3 + 4 — install Apple's reply and export the .p12 the runner needs.
 */
async function installCertificate({ keytool, cerPath, password, onLine = () => {} }) {
  requireKeytool(keytool);
  const p = paths();
  if (!fs.existsSync(p.keystore)) {
    throw new Error('No signing key yet — create the request first, then upload it to Apple.');
  }
  if (!cerPath || !fs.existsSync(cerPath)) throw new Error('Could not find ' + cerPath);

  onLine('fetching Apple\'s certificate authority chain…');
  for (const ca of APPLE_CA) {
    const file = path.join(p.dir, ca.alias + '.cer');
    // A copy already sitting there is used as-is. That is what makes the
    // "save it manually" advice below actually work behind a proxy that
    // blocks apple.com, and it costs nothing when the download succeeds.
    if (fs.existsSync(file) && fs.statSync(file).size > 0) {
      onLine('  ' + ca.alias + ' — using the copy already in ' + p.dir);
    } else {
      try {
        await download(ca.url, file);
      } catch (err) {
        throw new Error('Could not download ' + ca.url + ' (' + err.message + ').\n'
          + 'Save it manually into ' + p.dir + ' as ' + ca.alias + '.cer and try again.');
      }
    }
    const imp = await run({
      file: keytool,
      args: ['-importcert', '-noprompt', '-trustcacerts', '-alias', ca.alias, '-file', file,
        '-keystore', p.keystore, '-storepass', password],
    });
    // Re-importing an identical certificate is a no-op, not a failure.
    if (imp.code !== 0 && !/already exists|same as/i.test(tail(imp))) {
      throw new Error('Could not import ' + ca.alias + ':\n' + tail(imp));
    }
    onLine('  ' + ca.alias + ' ok');
  }

  onLine('installing your certificate…');
  const reply = await run({
    file: keytool,
    args: ['-importcert', '-noprompt', '-trustcacerts', '-alias', KEY_ALIAS, '-file', cerPath,
      '-keystore', p.keystore, '-storepass', password, '-keypass', password],
  });
  if (reply.code !== 0) {
    const detail = tail(reply);
    if (/Failed to establish chain/i.test(detail)) {
      throw new Error('Apple\'s certificate does not chain to the authorities Forge downloaded.\n'
        + 'That usually means the .cer is a *development* certificate, or it was issued for a different key. '
        + 'Download the Apple Distribution certificate for this CSR and try again.\n\n' + detail);
    }
    if (/does not match|Public keys in reply/i.test(detail)) {
      throw new Error('That certificate belongs to a different key pair — it was issued for another CSR.\n'
        + 'Generate a fresh request and upload that one.\n\n' + detail);
    }
    throw new Error('keytool refused Apple\'s certificate:\n' + detail);
  }

  onLine('exporting .p12 for the build runner…');
  try { fs.unlinkSync(p.p12); } catch (_) { /* first run */ }
  const exp = await run({
    file: keytool,
    args: [
      // Left on the JDK's modern defaults (PBES2 / AES-256). The older
      // PBEWithSHA1AndRC2_40 encoding is what Keychain used to emit and macOS
      // still reads it, but OpenSSL 3 now refuses it without -legacy — so it
      // is the deprecated path, not the safe one. macOS 12+ reads AES-256
      // PKCS#12 fine, and the runner is macOS 14.
      '-importkeystore', '-srckeystore', p.keystore, '-srcstorepass', password,
      '-srcalias', KEY_ALIAS, '-srckeypass', password,
      '-destkeystore', p.p12, '-deststoretype', 'PKCS12',
      '-deststorepass', password, '-destkeypass', password],
  });
  if (exp.code !== 0) throw new Error('Could not export the .p12:\n' + tail(exp));

  return { ok: true, p12: p.p12, dir: p.dir };
}

/** Read the team id and certificate subject back out, for display and for IOS_TEAM_ID. */
async function describeCertificate({ keytool, password }) {
  requireKeytool(keytool);
  const p = paths();
  if (!fs.existsSync(p.keystore)) return { ok: false, error: 'No signing key yet.' };
  const res = await run({
    file: keytool,
    args: ['-list', '-v', '-alias', KEY_ALIAS, '-keystore', p.keystore, '-storepass', password],
  });
  if (res.code !== 0) return { ok: false, error: tail(res) };
  const text = res.stdout || '';
  const owner = /Owner:\s*(.+)/.exec(text);
  const issuer = /Issuer:\s*(.+)/.exec(text);
  const until = /until:\s*(.+)/.exec(text);
  // Apple puts the team id in OU on the issued certificate.
  const ou = owner && /OU=([^,]+)/.exec(owner[1]);
  return {
    ok: true,
    owner: owner ? owner[1].trim() : null,
    issuer: issuer ? issuer[1].trim() : null,
    validUntil: until ? until[1].trim() : null,
    teamId: ou ? ou[1].trim() : null,
    issuedByApple: !!(issuer && /Apple/i.test(issuer[1])),
  };
}

/** GitHub secrets are pasted, not uploaded — encrypting them needs libsodium. */
function base64OfFile(file) {
  return fs.readFileSync(file).toString('base64');
}

/**
 * Everything that has to end up in GitHub → Settings → Secrets, with the
 * values already encoded. Returned rather than printed so the UI can offer a
 * copy button per row; secrets should not go through the log.
 */
/**
 * App Store Connect names the key file AuthKey_<KEYID>.p8 when you download
 * it, and that id is also a required secret — so read it off the filename
 * rather than asking for something the user already handed us.
 */
function ascKeyIdFromFilename(file) {
  const m = /AuthKey_([A-Z0-9]{8,12})\.p8$/i.exec(path.basename(String(file || '')));
  return m ? m[1] : null;
}

function secretBundle({ teamId, certPassword, keychainPassword, ascKeyId }) {
  const p = paths();
  const rows = [];
  if (fs.existsSync(p.p12)) rows.push({ name: 'IOS_CERT_P12', value: base64OfFile(p.p12), note: 'your signing certificate' });
  if (certPassword) rows.push({ name: 'IOS_CERT_PASSWORD', value: certPassword, note: 'the password you chose' });
  if (fs.existsSync(p.profile)) rows.push({ name: 'IOS_PROFILE', value: base64OfFile(p.profile), note: 'provisioning profile' });
  if (teamId) rows.push({ name: 'IOS_TEAM_ID', value: teamId, note: '10-character Apple team id' });
  rows.push({ name: 'KEYCHAIN_PASSWORD', value: keychainPassword || randomPassword(), note: 'any random string' });
  if (fs.existsSync(p.ascKey)) {
    rows.push({ name: 'ASC_PRIVATE_KEY', value: base64OfFile(p.ascKey), note: 'App Store Connect .p8 — TestFlight only' });
    if (ascKeyId) rows.push({ name: 'ASC_KEY_ID', value: ascKeyId, note: 'read from the .p8 filename' });
  }
  return rows;
}

function randomPassword() {
  return require('crypto').randomBytes(24).toString('base64url');
}

/* ------------------------------------------------------------- GitHub -- */

function ghRequest({ token, method = 'GET', route, body }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      host: 'api.github.com',
      path: route,
      method,
      headers: {
        'user-agent': 'Forge',
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        authorization: 'Bearer ' + token,
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { raw += d; });
      res.on('end', () => {
        const json = raw ? (() => { try { return JSON.parse(raw); } catch (_) { return null; } })() : null;
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve({ status: res.statusCode, json });
        reject(new Error(explainGithub(res.statusCode, json, route)));
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** GitHub's error bodies are terse; say what to actually do about them. */
function explainGithub(status, json, route) {
  const msg = (json && json.message) || 'no detail';
  if (status === 401) {
    return 'GitHub rejected the token (401). It is wrong, expired, or was revoked. Create a new fine-grained token with Actions: read and write.';
  }
  if (status === 403) {
    return 'GitHub refused the request (403: ' + msg + '). The token is valid but lacks permission — it needs Actions: read and write on this repository.';
  }
  if (status === 404) {
    return 'GitHub could not find ' + route + ' (404). Either the repository name is wrong, the workflow file has not been pushed yet, or the token cannot see this repository.';
  }
  if (status === 422) {
    return 'GitHub rejected the request (422: ' + msg + '). Usually the branch name is wrong, or the workflow has no workflow_dispatch trigger on that branch.';
  }
  return 'GitHub returned ' + status + ': ' + msg;
}

const WORKFLOW_FILE = 'ios-build.yml';

async function startBuild({ token, owner, repo, ref = 'main', configuration = 'Release', testflight = false }) {
  await ghRequest({
    token,
    method: 'POST',
    route: '/repos/' + owner + '/' + repo + '/actions/workflows/' + WORKFLOW_FILE + '/dispatches',
    body: { ref, inputs: { configuration, upload_testflight: String(!!testflight) } },
  });
  return { ok: true };
}

/** The dispatch response carries no run id, so find the run it created. */
async function findRun({ token, owner, repo, since }) {
  const { json } = await ghRequest({
    token,
    route: '/repos/' + owner + '/' + repo + '/actions/workflows/' + WORKFLOW_FILE + '/runs?per_page=10',
  });
  const runs = (json && json.workflow_runs) || [];
  const fresh = runs.filter((r) => !since || Date.parse(r.created_at) >= since - 60000);
  return fresh[0] || runs[0] || null;
}

async function runStatus({ token, owner, repo, runId }) {
  const { json } = await ghRequest({ token, route: '/repos/' + owner + '/' + repo + '/actions/runs/' + runId });
  return {
    id: json.id,
    status: json.status,
    conclusion: json.conclusion,
    url: json.html_url,
    startedAt: json.run_started_at,
  };
}

async function downloadArtifact({ token, owner, repo, runId, destDir }) {
  const { json } = await ghRequest({ token, route: '/repos/' + owner + '/' + repo + '/actions/runs/' + runId + '/artifacts' });
  const artifact = ((json && json.artifacts) || []).find((a) => /ipa/i.test(a.name)) || (json && json.artifacts || [])[0];
  if (!artifact) throw new Error('That run produced no artifacts. Open the run on GitHub to see why.');
  const dest = path.join(destDir, artifact.name + '.zip');
  await download('https://api.github.com/repos/' + owner + '/' + repo + '/actions/artifacts/' + artifact.id + '/zip',
    dest, { authorization: 'Bearer ' + token });
  return { ok: true, path: dest, name: artifact.name, bytes: fs.statSync(dest).size };
}

module.exports = {
  credentialsDir,
  paths,
  status,
  bundleId,
  setBundleId,
  parseRemoteUrl,
  repoFromDir,
  createCsr,
  installCertificate,
  describeCertificate,
  secretBundle,
  base64OfFile,
  ascKeyIdFromFilename,
  randomPassword,
  explainGithub,
  startBuild,
  findRun,
  runStatus,
  downloadArtifact,
  download,
  WORKFLOW_FILE,
  KEY_ALIAS,
};

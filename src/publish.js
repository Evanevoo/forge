'use strict';
/**
 * Publishing to Google Play, straight from Forge.
 *
 * Uses the Play Developer API with a service-account key. No SDK, no
 * dependencies — it's a signed JWT for an access token, then four REST calls:
 *
 *   1. open an "edit"        POST   …/edits
 *   2. upload the .aab       POST   …/edits/{id}/bundles        (media upload)
 *   3. put it on a track     PUT    …/edits/{id}/tracks/{track}
 *   4. commit the edit       POST   …/edits/{id}:commit
 *
 * Nothing is visible to anyone until step 4, so a failure part-way through
 * leaves your listing untouched — the abandoned edit simply expires.
 *
 * The service-account key stays on your disk. Forge reads it per-request and
 * never copies it anywhere.
 */
const fs = require('fs');
const https = require('https');
const path = require('path');
const crypto = require('crypto');

const API = 'androidpublisher.googleapis.com';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

const TRACKS = ['internal', 'alpha', 'beta', 'production'];

/* ------------------------------------------------------------------ auth -- */

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Build the signed assertion Google exchanges for an access token.
 * Pure and deterministic given `now`, so it can be tested.
 */
function buildJwt(serviceAccount, now = Math.floor(Date.now() / 1000)) {
  if (!serviceAccount || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('That service-account file is missing client_email or private_key.');
  }
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: serviceAccount.client_email,
    scope: SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(claims));
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), serviceAccount.private_key);
  return unsigned + '.' + b64url(signature);
}

function readServiceAccount(file) {
  if (!file || !fs.existsSync(file)) throw new Error('No service-account file at ' + file);
  let json;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    throw new Error('That file is not valid JSON — download the key again from Google Cloud.');
  }
  if (json.type !== 'service_account') {
    throw new Error('That looks like the wrong file. You want the service-account JSON key, whose "type" is "service_account".');
  }
  return json;
}

/* ------------------------------------------------------------------ http -- */

function request({ host, method, pathname, headers = {}, body, timeout = 600000 }) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host, method, path: pathname, headers, timeout }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch (_) { /* not json */ }
        resolve({ status: res.statusCode, body: parsed, text });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('The request timed out.')); });
    if (body instanceof require('stream').Readable) body.pipe(req);
    else { if (body) req.write(body); req.end(); }
  });
}

/** Turn Google's error envelope into something worth reading. */
function explain(res, what) {
  const g = res.body && res.body.error;
  const detail = g ? (g.message || JSON.stringify(g)) : (res.text || '').slice(0, 300);
  if (res.status === 401) return what + ' — not authorised. Check the service account is linked in Play Console under Users and permissions.';
  if (res.status === 403) return what + ' — permission denied. The service account needs "Release to production, exclude devices, and use app signing" on this app. (' + detail + ')';
  if (res.status === 404) return what + ' — not found. Check the application ID matches the app in Play Console exactly.';
  return what + ' — ' + (detail || ('HTTP ' + res.status));
}

async function accessToken(serviceAccount) {
  const form = 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')
    + '&assertion=' + encodeURIComponent(buildJwt(serviceAccount));
  const res = await request({
    host: 'oauth2.googleapis.com', method: 'POST', pathname: '/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(form) },
    body: form,
  });
  if (res.status !== 200 || !res.body || !res.body.access_token) {
    throw new Error(explain(res, 'Could not get an access token'));
  }
  return res.body.access_token;
}

/* --------------------------------------------------------------- publish -- */

/**
 * @param {object} o
 * @param {string} o.serviceAccountFile  path to the Google service-account JSON
 * @param {string} o.packageName         e.g. com.evanevoo.scanifiedandroid
 * @param {string} o.aabPath             the bundle to upload
 * @param {'internal'|'alpha'|'beta'|'production'} o.track
 * @param {string} [o.releaseNotes]
 * @param {boolean} [o.draft]            leave the release as a draft instead of rolling out
 * @param {(msg:string)=>void} [o.onProgress]
 */
async function publishToPlay(o) {
  const say = o.onProgress || (() => {});
  if (!TRACKS.includes(o.track)) throw new Error('Unknown track: ' + o.track);
  if (!o.aabPath || !fs.existsSync(o.aabPath)) throw new Error('No bundle at ' + o.aabPath);
  if (!/\.aab$/i.test(o.aabPath)) throw new Error('Google Play takes an .aab. An .apk can only be uploaded to older apps.');
  if (!o.packageName) throw new Error('No application ID.');

  const sa = readServiceAccount(o.serviceAccountFile);
  say('authenticating as ' + sa.client_email);
  const token = await accessToken(sa);
  const auth = { authorization: 'Bearer ' + token };
  const base = '/androidpublisher/v3/applications/' + encodeURIComponent(o.packageName);

  say('opening an edit');
  const edit = await request({ host: API, method: 'POST', pathname: base + '/edits', headers: { ...auth, 'content-length': 0 } });
  if (edit.status !== 200) throw new Error(explain(edit, 'Could not open an edit'));
  const editId = edit.body.id;

  const size = fs.statSync(o.aabPath).size;
  say('uploading ' + path.basename(o.aabPath) + ' (' + (size / 1048576).toFixed(1) + ' MB) — this is the slow part');
  const upload = await request({
    host: API, method: 'POST',
    pathname: '/upload' + base + '/edits/' + editId + '/bundles?uploadType=media',
    headers: { ...auth, 'content-type': 'application/octet-stream', 'content-length': size },
    body: fs.createReadStream(o.aabPath),
  });
  if (upload.status !== 200) throw new Error(explain(upload, 'Upload failed'));
  const versionCode = upload.body.versionCode;
  say('accepted as version code ' + versionCode);

  say('assigning to the ' + o.track + ' track');
  const release = {
    versionCodes: [String(versionCode)],
    status: o.draft ? 'draft' : 'completed',
  };
  if (o.releaseNotes) release.releaseNotes = [{ language: 'en-US', text: o.releaseNotes }];
  const trackBody = JSON.stringify({ track: o.track, releases: [release] });
  const trackRes = await request({
    host: API, method: 'PUT',
    pathname: base + '/edits/' + editId + '/tracks/' + o.track,
    headers: { ...auth, 'content-type': 'application/json', 'content-length': Buffer.byteLength(trackBody) },
    body: trackBody,
  });
  if (trackRes.status !== 200) throw new Error(explain(trackRes, 'Could not assign the build to the ' + o.track + ' track'));

  say('committing');
  const commit = await request({
    host: API, method: 'POST', pathname: base + '/edits/' + editId + ':commit',
    headers: { ...auth, 'content-length': 0 },
  });
  if (commit.status !== 200) throw new Error(explain(commit, 'Could not commit the release'));

  return {
    versionCode,
    track: o.track,
    status: release.status,
    editId,
    consoleUrl: 'https://play.google.com/console',
  };
}

module.exports = { publishToPlay, buildJwt, readServiceAccount, explain, TRACKS };

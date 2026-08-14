'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const publish = require('../src/publish');

/* A throwaway RSA key standing in for a Google service account. */
const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = {
  type: 'service_account',
  client_email: 'forge@my-project.iam.gserviceaccount.com',
  private_key: kp.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
};

const decode = (seg) => JSON.parse(Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());

test('the JWT is shaped the way Google requires', () => {
  const now = 1786600000;
  const [h, c] = publish.buildJwt(SA, now).split('.');
  assert.deepEqual(decode(h), { alg: 'RS256', typ: 'JWT' });
  const claims = decode(c);
  assert.equal(claims.iss, SA.client_email);
  assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/androidpublisher');
  assert.equal(claims.iat, now);
  assert.equal(claims.exp, now + 3600, 'one hour, the maximum Google accepts');
});

test('the JWT signature verifies with the public half', () => {
  const jwt = publish.buildJwt(SA, 1786600000);
  const [h, c, sig] = jwt.split('.');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(h + '.' + c), kp.publicKey,
    Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
  assert.equal(ok, true);
});

test('a key file missing its fields is rejected before any network call', () => {
  assert.throws(() => publish.buildJwt({ client_email: 'x' }), /client_email or private_key/);
  assert.throws(() => publish.buildJwt(null), /client_email or private_key/);
});

test('the wrong JSON file is named as such', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-sa-'));
  const oauth = path.join(tmp, 'client_secret.json');
  fs.writeFileSync(oauth, JSON.stringify({ installed: { client_id: 'x' } }));
  assert.throws(() => publish.readServiceAccount(oauth), /service-account JSON key/);

  const junk = path.join(tmp, 'junk.json');
  fs.writeFileSync(junk, 'not json at all');
  assert.throws(() => publish.readServiceAccount(junk), /not valid JSON/);

  assert.throws(() => publish.readServiceAccount(path.join(tmp, 'missing.json')), /No service-account file/);

  const good = path.join(tmp, 'sa.json');
  fs.writeFileSync(good, JSON.stringify(SA));
  assert.equal(publish.readServiceAccount(good).client_email, SA.client_email);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('Google\'s error codes become advice, not status numbers', () => {
  assert.match(publish.explain({ status: 401, body: null, text: '' }, 'Upload failed'), /not authorised.*Users and permissions/);
  assert.match(publish.explain({ status: 403, body: { error: { message: 'nope' } } }, 'Upload failed'), /permission denied.*Release to production/);
  assert.match(publish.explain({ status: 404, body: null, text: '' }, 'Upload failed'), /application ID matches/);
  assert.match(publish.explain({ status: 500, body: { error: { message: 'boom' } } }, 'Upload failed'), /boom/);
});

test('obvious mistakes are caught before uploading 92 MB', async () => {
  await assert.rejects(publish.publishToPlay({ track: 'nightly' }), /Unknown track/);
  await assert.rejects(publish.publishToPlay({ track: 'internal', aabPath: '/nope.aab' }), /No bundle at/);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-pub-'));
  const apk = path.join(tmp, 'app-release.apk');
  fs.writeFileSync(apk, 'x');
  await assert.rejects(publish.publishToPlay({ track: 'internal', aabPath: apk }), /takes an \.aab/);

  const aab = path.join(tmp, 'app-release.aab');
  fs.writeFileSync(aab, 'x');
  await assert.rejects(publish.publishToPlay({ track: 'internal', aabPath: aab }), /No application ID/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('every Play track is offered', () => {
  assert.deepEqual(publish.TRACKS, ['internal', 'alpha', 'beta', 'production']);
});

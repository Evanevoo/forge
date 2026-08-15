'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const license = require('../src/license');

/* A throwaway vendor key pair, standing in for the one the CLI generates. */
const vendor = crypto.generateKeyPairSync('ed25519');
const VENDOR_PUB = vendor.publicKey.export({ type: 'spki', format: 'pem' }).toString();

function mint(payload, signWith = vendor.privateKey) {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const sig = crypto.sign(null, Buffer.from(b64, 'utf8'), signWith);
  return license.formatKey(payload, sig);
}

test('a genuine key verifies and carries the buyer details', () => {
  const key = mint({ v: 1, name: 'Jane Smith', email: 'jane@example.com', iat: Date.now() });
  const res = license.verifyKey(key, VENDOR_PUB);
  assert.equal(res.valid, true);
  assert.equal(res.payload.name, 'Jane Smith');
  assert.equal(res.payload.email, 'jane@example.com');
});

test('a key signed by anyone else is rejected', () => {
  const impostor = crypto.generateKeyPairSync('ed25519');
  const key = mint({ v: 1, name: 'Pirate' }, impostor.privateKey);
  const res = license.verifyKey(key, VENDOR_PUB);
  assert.equal(res.valid, false);
  assert.match(res.reason, /not genuine/i);
});

test('editing the payload invalidates the signature', () => {
  const key = mint({ v: 1, name: 'Jane', email: 'jane@example.com', iat: Date.now() });
  const [prefix, payload, sig] = key.split('.');
  const tampered = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  tampered.name = 'Someone Else';
  const forged = [prefix,
    Buffer.from(JSON.stringify(tampered)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    sig].join('.');
  assert.equal(license.verifyKey(forged, VENDOR_PUB).valid, false);
});

test('malformed input fails cleanly rather than throwing', () => {
  for (const bad of ['', '   ', 'hello', 'FORGE-1.abc', 'FORGE-9.a.b', null, undefined, 42]) {
    const res = license.verifyKey(bad, VENDOR_PUB);
    assert.equal(res.valid, false);
    assert.ok(res.reason && res.reason.length, 'every rejection explains itself');
  }
});

test('an expired key is rejected, a future-dated one accepted', () => {
  const past = mint({ v: 1, name: 'Old', exp: Date.now() - 1000 });
  assert.equal(license.verifyKey(past, VENDOR_PUB).valid, false);
  assert.match(license.verifyKey(past, VENDOR_PUB).reason, /expired/i);

  const future = mint({ v: 1, name: 'Current', exp: Date.now() + 86400000 });
  assert.equal(license.verifyKey(future, VENDOR_PUB).valid, true);
});

test('the placeholder public key shipped in source validates nothing', () => {
  const key = mint({ v: 1, name: 'Jane' });
  assert.equal(license.verifyKey(key).valid, false,
    'source ships a public key nobody holds the private half of');
});

/* ----------------------------------------------------- trial behaviour -- */

function withTempData(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-lic-'));
  const cwd = process.cwd();
  process.chdir(tmp);
  try { fn(tmp); } finally { process.chdir(cwd); fs.rmSync(tmp, { recursive: true, force: true }); }
}

test('two trial builds are allowed, the third is not', () => {
  withTempData(() => {
    assert.equal(license.status().trialRemaining, 2);
    assert.equal(license.canBuild().allowed, true);

    license.recordSuccessfulBuild();
    assert.equal(license.status().trialRemaining, 1);
    assert.equal(license.canBuild().allowed, true);

    license.recordSuccessfulBuild();
    const s = license.status();
    assert.equal(s.trialRemaining, 0);
    const gate = license.canBuild();
    assert.equal(gate.allowed, false);
    assert.match(gate.reason, /licence key/i);
  });
});

test('activating a bad key changes nothing', () => {
  withTempData(() => {
    assert.throws(() => license.activate('FORGE-1.nonsense.nonsense'), /not.*Forge licence key|damaged|not genuine/i);
    assert.equal(license.status().licensed, false);
    assert.equal(license.canBuild().allowed, true, 'trial is untouched by a failed activation');
  });
});

test('a licensed install builds without consuming trials', () => {
  withTempData(() => {
    // Simulate the vendor's own public key being compiled in.
    const key = mint({ v: 1, name: 'Jane Smith', email: 'jane@example.com', iat: Date.now() });
    const realVerify = license.verifyKey;
    const patched = (k, pem) => realVerify(k, pem || VENDOR_PUB);
    require('../src/license').verifyKey = patched;

    license.activate(key);
    const s = license.status();
    assert.equal(s.licensed, true);
    assert.equal(s.licensedTo, 'Jane Smith');

    license.recordSuccessfulBuild();
    license.recordSuccessfulBuild();
    license.recordSuccessfulBuild();
    assert.equal(license.canBuild().allowed, true, 'a paying customer is never gated');
    assert.equal(license.status().trialBuilds, 0, 'licensed builds do not spend trials');

    require('../src/license').verifyKey = realVerify;
  });
});

test('a key mangled by console wrapping or an email client still verifies', () => {
  const key = mint({ v: 1, name: 'Jane Smith', iat: Date.now() });
  const wrapped = key.slice(0, 40) + '\r\n' + key.slice(40, 120) + '\n  ' + key.slice(120);
  assert.equal(license.verifyKey(wrapped, VENDOR_PUB).valid, true,
    'whitespace anywhere in the key is the terminal\'s fault, not the buyer\'s');
  assert.equal(license.verifyKey('  ' + key + '\n', VENDOR_PUB).valid, true);
});

test('a rejection says what was actually pasted', () => {
  const cases = [
    [VENDOR_PUB, /public key/i],
    [vendor.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), /private signing key/i],
    ['FORGE-1.eyJ2Ijox...', /abbreviated|\.\.\./i],
    ['FORGE-1.eyJ2Ijox', /cut short/i],
    ['C:\\Users\\evank\\.forge-signing\\private.pem', /starts with/i],
  ];
  for (const [input, expected] of cases) {
    const res = license.verifyKey(input, VENDOR_PUB);
    assert.equal(res.valid, false);
    assert.match(res.reason, expected, 'input: ' + input.slice(0, 30));
  }
});

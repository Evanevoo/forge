'use strict';
const test = require('node:test');
const assert = require('node:assert');
const verify = require('../src/verify');

const REAL_SHA1 = '2F:23:50:65:5C:07:7A:BB:39:30:70:FD:65:39:B4:94:FA:89:12:70';

/* apksigner prints digests as unseparated lowercase hex. */
const APKSIGNER_OUT = `Verifies
Verified using v1 scheme (JAR signing): false
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): true
Signer #1 certificate DN: CN=, OU=, O=, L=, ST=, C=US
Signer #1 certificate SHA-256 digest: 492f6044659ac029a598c6448908cce7034176fcba999f5acce0068c0e002576
Signer #1 certificate SHA-1 digest: 2f2350655c077abb393070fd6539b494fa891270
Signer #1 certificate MD5 digest: 5d91aaaaaaaaaaaaaaaaaaaaaaaa4aaf
`;

/* keytool -printcert -jarfile output, as produced by a real signed bundle. */
const KEYTOOL_OUT = `Signer #1:

Signature:

Owner: CN=, OU=, O=, L=, ST=, C=US
Issuer: CN=, OU=, O=, L=, ST=, C=US
Serial number: 4b2c1d
Valid from: Wed Nov 19 19:44:07 UTC 2025 until: Sun Apr 06 19:44:07 UTC 2053
Certificate fingerprints:
	 SHA1: 2F:23:50:65:5C:07:7A:BB:39:30:70:FD:65:39:B4:94:FA:89:12:70
	 SHA256: 49:2F:60:44:65:9A:C0:29:A5:98:C6:44:89:08:CC:E7:03:41:76:FC:BA:99:9F:5A:CC:E0:06:8C:0E:00:25:76
Signature algorithm name: SHA256withRSA
`;

test('reads the signing certificate out of apksigner output', () => {
  assert.equal(verify.parseApksignerSha1(APKSIGNER_OUT), REAL_SHA1);
  assert.equal(verify.parseApksignerSha1('Verifies\n'), null);
});

test('reads the signing certificate out of keytool output', () => {
  assert.equal(verify.parseKeytoolSha1(KEYTOOL_OUT), REAL_SHA1);
  assert.equal(verify.parseKeytoolSha1('Not a signed jar file'), null);
});

test('compares fingerprints regardless of formatting', () => {
  // apksigner's unseparated lowercase vs keytool's colon-separated uppercase
  // must compare equal, or every APK would look wrongly signed.
  assert.ok(verify.fingerprintsMatch('2f2350655c077abb393070fd6539b494fa891270', REAL_SHA1));
  assert.ok(verify.fingerprintsMatch(REAL_SHA1.toLowerCase(), REAL_SHA1));
  assert.ok(!verify.fingerprintsMatch(REAL_SHA1, 'BA:60:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:0E:8E'));
});

test('a missing or malformed fingerprint never counts as a match', () => {
  assert.equal(verify.normaliseFingerprint(null), null);
  assert.equal(verify.normaliseFingerprint('AB:CD'), null, 'too short to be a SHA-1');
  assert.ok(!verify.fingerprintsMatch(null, REAL_SHA1));
  assert.ok(!verify.fingerprintsMatch(REAL_SHA1, null));
  assert.ok(!verify.fingerprintsMatch(null, null));
});

test('reports a missing artifact instead of claiming success', async () => {
  const res = await verify.verifyArtifact({ file: '/nope/missing.aab', sdk: {}, jdk: {} });
  assert.equal(res.checked, false);
  assert.equal(res.signed, null);
  assert.match(res.message, /not found/i);
});

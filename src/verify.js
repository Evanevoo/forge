'use strict';
/**
 * Prove the artifact is actually signed by the key you selected.
 *
 * Gradle will happily produce an unsigned or wrongly-signed release in several
 * situations, and you find out when Google Play rejects the upload. Reading the
 * signature back off the finished file and comparing it to the keystore's own
 * fingerprint turns that into a five-second local check.
 *
 *   .apk  — apksigner (Android build-tools). Understands v2/v3 signing schemes,
 *           which a modern APK uses instead of the old JAR signature.
 *   .aab  — keytool -printcert -jarfile. A bundle is always JAR-signed, and
 *           apksigner does not accept .aab.
 */
const fs = require('fs');
const path = require('path');
const { run, IS_WIN } = require('./exec');
const { versionSort } = require('./prereqs');

/** Normalise a fingerprint to AA:BB:CC… uppercase for comparison. */
function normaliseFingerprint(value) {
  if (!value) return null;
  const hex = String(value).replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (hex.length < 40) return null;
  return (hex.match(/.{2}/g) || []).join(':');
}

function fingerprintsMatch(a, b) {
  const na = normaliseFingerprint(a);
  const nb = normaliseFingerprint(b);
  return !!(na && nb && na === nb);
}

/** apksigner prints `Signer #1 certificate SHA-1 digest: <40 hex chars>`. */
function parseApksignerSha1(text) {
  const m = /Signer #\d+ certificate SHA-1 digest:\s*([0-9a-fA-F]{40})/.exec(text || '');
  return m ? normaliseFingerprint(m[1]) : null;
}

/** keytool -printcert prints `SHA1: AA:BB:…`. */
function parseKeytoolSha1(text) {
  const m = /SHA1:\s*([0-9A-Fa-f:]{40,})/.exec(text || '');
  return m ? normaliseFingerprint(m[1]) : null;
}

function apksignerPath(sdk) {
  if (!sdk || !sdk.path) return null;
  const base = path.join(sdk.path, 'build-tools');
  let versions = [];
  try {
    versions = fs.readdirSync(base).filter((n) => fs.existsSync(path.join(base, n, 'apksigner' + (IS_WIN ? '.bat' : ''))));
  } catch (_) {
    return null;
  }
  versions.sort(versionSort);
  if (!versions.length) return null;
  return path.join(base, versions[0], 'apksigner' + (IS_WIN ? '.bat' : ''));
}

/**
 * @returns {{checked:boolean, signed:boolean|null, sha1:string|null,
 *            matchesKey:boolean|null, tool:string|null, message:string}}
 */
async function verifyArtifact({ file, sdk, jdk, expectedSha1 }) {
  if (!file || !fs.existsSync(file)) {
    return { checked: false, signed: null, sha1: null, matchesKey: null, tool: null, message: 'Artifact not found.' };
  }
  const isApk = file.toLowerCase().endsWith('.apk');

  if (isApk) {
    const signer = apksignerPath(sdk);
    if (!signer) {
      return { checked: false, signed: null, sha1: null, matchesKey: null, tool: null, message: 'apksigner not found in the Android SDK build-tools.' };
    }
    const res = await run({ file: signer, args: ['verify', '--print-certs', file], timeout: 120000 });
    const text = (res.stdout || '') + (res.stderr || '');
    if (res.code !== 0) {
      return { checked: true, signed: false, sha1: null, matchesKey: false, tool: 'apksigner', message: firstLine(text) || 'apksigner reported the APK is not signed.' };
    }
    const sha1 = parseApksignerSha1(text);
    return buildResult('apksigner', sha1, expectedSha1);
  }

  if (!jdk || !jdk.keytoolExe) {
    return { checked: false, signed: null, sha1: null, matchesKey: null, tool: null, message: 'keytool unavailable.' };
  }
  const res = await run({ file: jdk.keytoolExe, args: ['-printcert', '-jarfile', file], timeout: 120000 });
  const text = (res.stdout || '') + (res.stderr || '');
  if (res.code !== 0 || /Not a signed jar file/i.test(text)) {
    return { checked: true, signed: false, sha1: null, matchesKey: false, tool: 'keytool', message: 'The bundle is not signed.' };
  }
  const sha1 = parseKeytoolSha1(text);
  return buildResult('keytool', sha1, expectedSha1);
}

function buildResult(tool, sha1, expectedSha1) {
  if (!sha1) {
    return { checked: true, signed: null, sha1: null, matchesKey: null, tool, message: 'Could not read a signing certificate from the artifact.' };
  }
  if (!expectedSha1) {
    return { checked: true, signed: true, sha1, matchesKey: null, tool, message: 'Signed (SHA-1 ' + sha1 + ').' };
  }
  const matchesKey = fingerprintsMatch(sha1, expectedSha1);
  return {
    checked: true,
    signed: true,
    sha1,
    matchesKey,
    tool,
    message: matchesKey
      ? 'Signature verified — matches the selected key.'
      : 'SIGNED BY A DIFFERENT KEY. Artifact SHA-1 ' + sha1 + ', expected ' + normaliseFingerprint(expectedSha1) + '. An app store will reject this.',
  };
}

function firstLine(text) {
  return (text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || '';
}

module.exports = {
  verifyArtifact,
  parseApksignerSha1,
  parseKeytoolSha1,
  normaliseFingerprint,
  fingerprintsMatch,
  apksignerPath,
};

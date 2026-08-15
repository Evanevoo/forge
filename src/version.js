'use strict';
/**
 * Version bumping.
 *
 * Android rejects an upload whose versionCode it has already seen, which is
 * the single most common reason a release bounces after a perfectly good
 * build. Bumping by hand means editing two files that must agree:
 *
 *   android/app/build.gradle   what the build actually compiles in
 *   app.json                   what `expo prebuild` regenerates it from
 *
 * Edit only the first and the next prebuild silently reverts you. Edit only
 * the second and this build doesn't change. Forge writes both.
 */
const fs = require('fs');
const path = require('path');

/* --------------------------------------------------------------- parsing -- */

// AGP accepts `versionCode 5` and `versionCode = 5`; templates use both.
const CODE_RE = /(\bversionCode\s*=?\s*)(\d+)/;
const NAME_RE = /(\bversionName\s*=?\s*["'])([^"']+)(["'])/;

function parseGradle(text) {
  const c = CODE_RE.exec(text);
  const n = NAME_RE.exec(text);
  return {
    versionCode: c ? parseInt(c[2], 10) : null,
    versionName: n ? n[2] : null,
  };
}

/** "1.2.0" → {major:1, minor:2, patch:0}; tolerates "1.2" and "1". */
function parseSemver(v) {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(v || ''));
  if (!m) return null;
  return { major: +m[1], minor: +(m[2] || 0), patch: +(m[3] || 0) };
}

function bumpSemver(v, kind) {
  const p = parseSemver(v);
  if (!p) return null;
  if (kind === 'major') return (p.major + 1) + '.0.0';
  if (kind === 'minor') return p.major + '.' + (p.minor + 1) + '.0';
  if (kind === 'patch') return p.major + '.' + p.minor + '.' + (p.patch + 1);
  return v;
}

/**
 * Work out the new values without touching anything.
 * @param {{versionCode:number|null, versionName:string|null}} current
 * @param {{code?: 'increment'|'keep'|number, name?: 'major'|'minor'|'patch'|'keep'|string}} plan
 */
function nextVersion(current, plan = {}) {
  const codeMode = plan.code === undefined ? 'increment' : plan.code;
  const nameMode = plan.name === undefined ? 'keep' : plan.name;

  let versionCode = current.versionCode;
  if (codeMode === 'increment') versionCode = (current.versionCode || 0) + 1;
  else if (typeof codeMode === 'number') {
    if (!Number.isInteger(codeMode) || codeMode < 1) throw new Error('versionCode must be a whole number of 1 or more.');
    versionCode = codeMode;
  }

  let versionName = current.versionName;
  if (['major', 'minor', 'patch'].includes(nameMode)) {
    const next = bumpSemver(current.versionName, nameMode);
    if (!next) throw new Error('Could not read "' + current.versionName + '" as a version number.');
    versionName = next;
  } else if (typeof nameMode === 'string' && nameMode !== 'keep') {
    if (!/^\d+(\.\d+)*$/.test(nameMode)) throw new Error('A version name should look like 1.2.3.');
    versionName = nameMode;
  }

  return { versionCode, versionName };
}

function applyToGradle(text, next) {
  let out = text;
  if (next.versionCode != null) out = out.replace(CODE_RE, (m, a) => a + next.versionCode);
  if (next.versionName != null) out = out.replace(NAME_RE, (m, a, _v, c) => a + next.versionName + c);
  return out;
}

/** Mirror the change into app.json so a later prebuild doesn't undo it. */
function applyToAppJson(json, next) {
  const out = JSON.parse(JSON.stringify(json));
  if (!out.expo) return out;
  if (next.versionName != null) out.expo.version = next.versionName;
  if (next.versionCode != null) {
    out.expo.android = out.expo.android || {};
    out.expo.android.versionCode = next.versionCode;
    // iOS counts separately but must also rise on every upload; keeping it in
    // step with the Android code is the least surprising thing to do.
    out.expo.ios = out.expo.ios || {};
    out.expo.ios.buildNumber = String(next.versionCode);
  }
  return out;
}

/* ---------------------------------------------------------------- on disk -- */

const gradlePath = (dir) => path.join(dir, 'android', 'app', 'build.gradle');
const appJsonPath = (dir) => path.join(dir, 'app.json');

function read(projectDir) {
  const gFile = gradlePath(projectDir);
  const aFile = appJsonPath(projectDir);
  const out = {
    gradle: { file: gFile, exists: fs.existsSync(gFile), versionCode: null, versionName: null },
    appJson: { file: aFile, exists: fs.existsSync(aFile), version: null, versionCode: null, buildNumber: null },
  };
  if (out.gradle.exists) {
    Object.assign(out.gradle, parseGradle(fs.readFileSync(gFile, 'utf8')));
  }
  if (out.appJson.exists) {
    try {
      const j = JSON.parse(fs.readFileSync(aFile, 'utf8'));
      out.appJson.version = (j.expo && j.expo.version) || null;
      out.appJson.versionCode = (j.expo && j.expo.android && j.expo.android.versionCode) || null;
      out.appJson.buildNumber = (j.expo && j.expo.ios && j.expo.ios.buildNumber) || null;
    } catch (_) { out.appJson.exists = false; }
  }
  // The build compiles what Gradle says, so that's the number that matters.
  out.current = {
    versionCode: out.gradle.versionCode != null ? out.gradle.versionCode : out.appJson.versionCode,
    versionName: out.gradle.versionName || out.appJson.version,
  };
  out.inSync = !out.appJson.exists || !out.gradle.exists
    || (out.appJson.versionCode == null && out.appJson.version == null)
    || (String(out.appJson.version) === String(out.gradle.versionName)
        && Number(out.appJson.versionCode) === Number(out.gradle.versionCode));
  return out;
}

function bump(projectDir, plan = {}) {
  const info = read(projectDir);
  if (!info.gradle.exists && !info.appJson.exists) {
    throw new Error('Nothing to bump — no android/app/build.gradle and no app.json.');
  }
  if (info.current.versionCode == null && plan.code !== undefined && typeof plan.code !== 'number') {
    throw new Error('No versionCode found to increment. Set one explicitly.');
  }
  const next = nextVersion(info.current, plan);
  const written = [];

  if (info.gradle.exists) {
    const text = fs.readFileSync(info.gradle.file, 'utf8');
    const updated = applyToGradle(text, next);
    if (updated !== text) {
      const backup = info.gradle.file + '.forge-version-backup';
      if (!fs.existsSync(backup)) fs.writeFileSync(backup, text, 'utf8');
      fs.writeFileSync(info.gradle.file, updated, 'utf8');
      written.push(info.gradle.file);
    }
  }
  if (info.appJson.exists) {
    const raw = fs.readFileSync(info.appJson.file, 'utf8');
    const json = JSON.parse(raw);
    const updated = applyToAppJson(json, next);
    const text = JSON.stringify(updated, null, 2) + '\n';
    if (text !== raw) {
      fs.writeFileSync(info.appJson.file, text, 'utf8');
      written.push(info.appJson.file);
    }
  }

  return { before: info.current, after: next, written, info: read(projectDir) };
}

module.exports = {
  read,
  bump,
  nextVersion,
  parseGradle,
  parseSemver,
  bumpSemver,
  applyToGradle,
  applyToAppJson,
};

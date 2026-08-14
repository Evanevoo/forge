'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const version = require('../src/version');
const { EXPO_APP_BUILD_GRADLE } = require('./fixtures');

test('reads versionCode and versionName in both AGP syntaxes', () => {
  assert.deepEqual(version.parseGradle(EXPO_APP_BUILD_GRADLE), { versionCode: 1, versionName: '1.0.0' });
  assert.deepEqual(version.parseGradle('versionCode = 201\nversionName = "1.2.0"'),
    { versionCode: 201, versionName: '1.2.0' });
  assert.deepEqual(version.parseGradle('nothing here'), { versionCode: null, versionName: null });
});

test('semver bumping follows the usual rules', () => {
  assert.equal(version.bumpSemver('1.2.0', 'patch'), '1.2.1');
  assert.equal(version.bumpSemver('1.2.9', 'minor'), '1.3.0');
  assert.equal(version.bumpSemver('1.9.9', 'major'), '2.0.0');
  assert.equal(version.bumpSemver('1.2', 'patch'), '1.2.1', 'a two-part version still works');
  assert.equal(version.bumpSemver('nope', 'patch'), null);
});

test('build number increments by default and the name is left alone', () => {
  assert.deepEqual(version.nextVersion({ versionCode: 201, versionName: '1.2.0' }, {}),
    { versionCode: 202, versionName: '1.2.0' });
});

test('an explicit build number is accepted, nonsense is refused', () => {
  assert.equal(version.nextVersion({ versionCode: 5, versionName: '1.0.0' }, { code: 300 }).versionCode, 300);
  assert.throws(() => version.nextVersion({ versionCode: 5, versionName: '1.0.0' }, { code: 0 }), /whole number/);
  assert.throws(() => version.nextVersion({ versionCode: 5, versionName: '1.0.0' }, { code: 1.5 }), /whole number/);
});

test('an explicit version name must look like a version', () => {
  assert.equal(version.nextVersion({ versionCode: 1, versionName: '1.0.0' }, { name: '2.5.1' }).versionName, '2.5.1');
  assert.throws(() => version.nextVersion({ versionCode: 1, versionName: '1.0.0' }, { name: 'v2-beta' }), /look like/);
});

/* ------------------------------------------------------------- on disk -- */

function project(build = EXPO_APP_BUILD_GRADLE, appJson) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-ver-'));
  fs.mkdirSync(path.join(tmp, 'android', 'app'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'android', 'app', 'build.gradle'), build);
  if (appJson) fs.writeFileSync(path.join(tmp, 'app.json'), JSON.stringify(appJson, null, 2));
  return tmp;
}

test('bumping writes build.gradle AND app.json, so prebuild cannot revert it', () => {
  const dir = project(EXPO_APP_BUILD_GRADLE.replace('versionCode 1', 'versionCode 201').replace('"1.0.0"', '"1.2.0"'), {
    expo: { name: 'Scanified', version: '1.2.0', android: { package: 'com.evanevoo.scanifiedandroid', versionCode: 201 } },
  });

  const res = version.bump(dir, { code: 'increment', name: 'patch' });
  assert.deepEqual(res.before, { versionCode: 201, versionName: '1.2.0' });
  assert.deepEqual(res.after, { versionCode: 202, versionName: '1.2.1' });
  assert.equal(res.written.length, 2, 'both files updated');

  const gradle = fs.readFileSync(path.join(dir, 'android', 'app', 'build.gradle'), 'utf8');
  assert.match(gradle, /versionCode 202/);
  assert.match(gradle, /versionName "1\.2\.1"/);

  const app = JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8'));
  assert.equal(app.expo.version, '1.2.1');
  assert.equal(app.expo.android.versionCode, 202);
  assert.equal(app.expo.ios.buildNumber, '202', 'iOS build number rises too');
  assert.equal(app.expo.android.package, 'com.evanevoo.scanifiedandroid', 'other config untouched');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('the original build.gradle is backed up once', () => {
  const dir = project();
  version.bump(dir, {});
  const backup = path.join(dir, 'android', 'app', 'build.gradle.forge-version-backup');
  assert.ok(fs.existsSync(backup));
  assert.equal(fs.readFileSync(backup, 'utf8'), EXPO_APP_BUILD_GRADLE, 'backup is the pristine original');
  version.bump(dir, {});
  assert.equal(fs.readFileSync(backup, 'utf8'), EXPO_APP_BUILD_GRADLE, 'and is not overwritten by later bumps');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('repeated bumps keep climbing', () => {
  const dir = project();
  assert.equal(version.bump(dir, {}).after.versionCode, 2);
  assert.equal(version.bump(dir, {}).after.versionCode, 3);
  assert.equal(version.bump(dir, {}).after.versionCode, 4);
  assert.equal(version.read(dir).current.versionCode, 4);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a project with no app.json still bumps the gradle file', () => {
  const dir = project();
  const res = version.bump(dir, { name: 'minor' });
  assert.equal(res.after.versionName, '1.1.0');
  assert.equal(res.written.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('disagreement between the two files is detected', () => {
  const dir = project(EXPO_APP_BUILD_GRADLE.replace('versionCode 1', 'versionCode 201'), {
    expo: { version: '1.0.0', android: { versionCode: 7 } },
  });
  assert.equal(version.read(dir).inSync, false, 'app.json says 7, gradle says 201');
  version.bump(dir, {});
  assert.equal(version.read(dir).inSync, true, 'bumping aligns them');
  fs.rmSync(dir, { recursive: true, force: true });
});

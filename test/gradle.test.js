'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const gradle = require('../src/gradle');
const { EXPO_APP_BUILD_GRADLE, BARE_APP_BUILD_GRADLE, TRICKY_APP_BUILD_GRADLE } = require('./fixtures');

test('injects forgeRelease into an existing signingConfigs block', () => {
  const { content, changed, notes } = gradle.patchBuildGradle(EXPO_APP_BUILD_GRADLE);
  assert.equal(changed, true);
  assert.match(content, /forgeRelease \{/);
  assert.match(content, /FORGE-SIGNING-START/);
  assert.match(content, /FORGE-SIGNING-END/);
  // The debug signing config must survive untouched.
  assert.match(content, /debug \{\s*\n\s*storeFile file\('debug\.keystore'\)/);
  assert.ok(notes.some((n) => /existing signingConfigs/.test(n)));
});

test('release build type is repointed at forgeRelease, remembering what it replaced', () => {
  const { content } = gradle.patchBuildGradle(EXPO_APP_BUILD_GRADLE);
  assert.match(content, /signingConfig signingConfigs\.forgeRelease \/\/ FORGE-SIGNING-RELEASE \(was: signingConfig signingConfigs\.debug\)/);
  // The debug build type keeps its own debug signing config.
  const debugBlock = /debug \{\n\s*signingConfig signingConfigs\.debug\n\s*\}/.exec(content);
  assert.ok(debugBlock, 'debug build type should be unchanged');
});

test('patching is idempotent', () => {
  const once = gradle.patchBuildGradle(EXPO_APP_BUILD_GRADLE).content;
  const twice = gradle.patchBuildGradle(once).content;
  const thrice = gradle.patchBuildGradle(twice).content;
  assert.equal(twice, once, 'second patch must not change anything');
  assert.equal(thrice, once, 'third patch must not change anything');
  assert.equal((once.match(/forgeRelease \{/g) || []).length, 1, 'exactly one forgeRelease block');
  assert.equal((once.match(/FORGE-SIGNING-RELEASE/g) || []).length, 1, 'exactly one release marker');
});

test('unpatch restores the original file byte-for-byte', () => {
  const patched = gradle.patchBuildGradle(EXPO_APP_BUILD_GRADLE).content;
  assert.equal(gradle.unpatch(patched), EXPO_APP_BUILD_GRADLE);
});

test('creates a signingConfigs block when the project has none', () => {
  const { content } = gradle.patchBuildGradle(BARE_APP_BUILD_GRADLE);
  assert.match(content, /signingConfigs \{/);
  assert.match(content, /forgeRelease \{/);
  assert.match(content, /signingConfig signingConfigs\.forgeRelease \/\/ FORGE-SIGNING-RELEASE \(was: NONE\)/);
  const twice = gradle.patchBuildGradle(content).content;
  assert.equal(twice, content);
  assert.equal(gradle.unpatch(content), BARE_APP_BUILD_GRADLE);
});

test('no secrets are written into build.gradle', () => {
  const { content } = gradle.patchBuildGradle(EXPO_APP_BUILD_GRADLE);
  assert.match(content, /System\.getenv\("FORGE_STORE_PASSWORD"\)/);
  assert.ok(!/storePassword\s+['"][^'"]*['"]/.test(content.split('forgeRelease {')[1].split('FORGE-SIGNING-END')[0]),
    'forgeRelease must never contain a literal password');
});

test('brace scanner ignores braces in strings and comments', () => {
  const { content } = gradle.patchBuildGradle(TRICKY_APP_BUILD_GRADLE);
  assert.match(content, /forgeRelease \{/);
  assert.match(content, /signingConfig signingConfigs\.forgeRelease/);
  assert.equal(gradle.unpatch(content), TRICKY_APP_BUILD_GRADLE);
});

test('rejects a file with no android block', () => {
  assert.throws(() => gradle.patchBuildGradle('apply plugin: "java"\n'), /Could not find an .android \{ \}. block/);
});

test('the patched gradle is still brace-balanced', () => {
  const { content } = gradle.patchBuildGradle(EXPO_APP_BUILD_GRADLE);
  const androidStart = content.indexOf('\nandroid {') + 1;
  const open = content.indexOf('{', androidStart);
  const close = gradle.matchBrace(content, open);
  assert.ok(close > 0, 'android block must still close');
  // Everything after the android block closes should be the dependencies block.
  assert.match(content.slice(close), /^\}\s*\n\s*dependencies \{/);
});

test('applySigningConfig writes a one-time backup and is re-runnable on disk', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-test-'));
  const appDir = path.join(tmp, 'android', 'app');
  fs.mkdirSync(appDir, { recursive: true });
  const file = path.join(appDir, 'build.gradle');
  fs.writeFileSync(file, EXPO_APP_BUILD_GRADLE);

  const first = gradle.applySigningConfig(tmp);
  assert.equal(first.changed, true);
  assert.ok(fs.existsSync(file + '.forge-backup'));
  assert.equal(fs.readFileSync(file + '.forge-backup', 'utf8'), EXPO_APP_BUILD_GRADLE);

  const after1 = fs.readFileSync(file, 'utf8');
  const second = gradle.applySigningConfig(tmp);
  assert.equal(second.changed, false, 're-running must be a no-op');
  assert.equal(fs.readFileSync(file, 'utf8'), after1);

  const status = gradle.inspectSigning(tmp);
  assert.equal(status.exists, true);
  assert.equal(status.patched, true);
  assert.equal(status.releaseWired, true);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('ensureLocalProperties writes an escaped sdk.dir once', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-test-'));
  fs.mkdirSync(path.join(tmp, 'android'), { recursive: true });

  const r1 = gradle.ensureLocalProperties(tmp, 'C:\\Users\\evank\\AppData\\Local\\Android\\Sdk');
  assert.equal(r1.changed, true);
  const text = fs.readFileSync(r1.file, 'utf8');
  assert.match(text, /sdk\.dir=C\\:\\\\Users\\\\evank\\\\AppData\\\\Local\\\\Android\\\\Sdk/);

  const r2 = gradle.ensureLocalProperties(tmp, 'C:\\Users\\evank\\AppData\\Local\\Android\\Sdk');
  assert.equal(r2.changed, false, 'must not duplicate sdk.dir');

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('rejects Kotlin DSL projects with a clear message', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-test-'));
  const appDir = path.join(tmp, 'android', 'app');
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, 'build.gradle.kts'), 'android { }');
  assert.throws(() => gradle.applySigningConfig(tmp), /Kotlin DSL/);
  const status = gradle.inspectSigning(tmp);
  assert.equal(status.kotlinDsl, true);
  fs.rmSync(tmp, { recursive: true, force: true });
});

/* ------------------------------------------------------ JVM memory ---- */

test('parses heap and metaspace out of org.gradle.jvmargs', () => {
  assert.deepEqual(gradle.parseJvmArgs('-Xmx2048m -XX:MaxMetaspaceSize=512m'), { heapMb: 2048, metaspaceMb: 512 });
  assert.deepEqual(gradle.parseJvmArgs('-Xmx4g -XX:MaxMetaspaceSize=2g'), { heapMb: 4096, metaspaceMb: 2048 });
  assert.deepEqual(gradle.parseJvmArgs('-Xmx2048m'), { heapMb: 2048, metaspaceMb: null });
  assert.deepEqual(gradle.parseJvmArgs(null), { heapMb: null, metaspaceMb: null });
});

test('recommends memory scaled to the machine', () => {
  assert.deepEqual(gradle.recommendJvmArgs(32 * 1024), { heapMb: 8192, metaspaceMb: 2048 });
  assert.deepEqual(gradle.recommendJvmArgs(16 * 1024), { heapMb: 6144, metaspaceMb: 2048 });
  assert.deepEqual(gradle.recommendJvmArgs(8 * 1024), { heapMb: 4096, metaspaceMb: 1024 });
  assert.deepEqual(gradle.recommendJvmArgs(4 * 1024), { heapMb: 2048, metaspaceMb: 1024 });
});

test('flags the React Native template default as too small', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-test-'));
  fs.mkdirSync(path.join(tmp, 'android'), { recursive: true });
  const file = path.join(tmp, 'android', 'gradle.properties');
  fs.writeFileSync(file, 'org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m\nandroid.useAndroidX=true\n');

  const before = gradle.inspectJvmArgs(tmp, 32 * 1024);
  assert.equal(before.ok, false);
  assert.equal(before.metaspaceMb, 512);
  assert.ok(before.reasons.some((r) => /MaxMetaspaceSize is 512 MB/.test(r)));

  const fixed = gradle.ensureJvmArgs(tmp, 32 * 1024);
  assert.equal(fixed.changed, true);
  assert.equal(fixed.heapMb, 8192);
  assert.equal(fixed.metaspaceMb, 2048);

  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /org\.gradle\.jvmargs=-Xmx8192m -XX:MaxMetaspaceSize=2048m/);
  assert.match(text, /android\.useAndroidX=true/, 'other properties must survive');
  assert.ok(fs.existsSync(file + '.forge-backup'));

  const after = gradle.inspectJvmArgs(tmp, 32 * 1024);
  assert.equal(after.ok, true);
  assert.equal(gradle.ensureJvmArgs(tmp, 32 * 1024).changed, false, 're-running must be a no-op');

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('never lowers a setting the developer already raised', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-test-'));
  fs.mkdirSync(path.join(tmp, 'android'), { recursive: true });
  const file = path.join(tmp, 'android', 'gradle.properties');
  fs.writeFileSync(file, 'org.gradle.jvmargs=-Xmx12288m -XX:MaxMetaspaceSize=4096m -Dfile.encoding=UTF-8\n');

  const res = gradle.ensureJvmArgs(tmp, 8 * 1024);
  assert.equal(res.changed, false);
  assert.equal(res.heapMb, 12288);
  assert.equal(res.metaspaceMb, 4096);
  assert.match(fs.readFileSync(file, 'utf8'), /-Dfile\.encoding=UTF-8/, 'unrelated flags are preserved');

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('adds jvmargs when the property is absent entirely', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-test-'));
  fs.mkdirSync(path.join(tmp, 'android'), { recursive: true });
  const file = path.join(tmp, 'android', 'gradle.properties');
  fs.writeFileSync(file, 'android.useAndroidX=true\n');

  const before = gradle.inspectJvmArgs(tmp, 32 * 1024);
  assert.equal(before.ok, false, 'no metaspace set at all is not OK');

  gradle.ensureJvmArgs(tmp, 32 * 1024);
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /^org\.gradle\.jvmargs=-Xmx8192m -XX:MaxMetaspaceSize=2048m$/m);
  assert.match(text, /android\.useAndroidX=true/);
  assert.equal(gradle.inspectJvmArgs(tmp, 32 * 1024).ok, true);

  fs.rmSync(tmp, { recursive: true, force: true });
});

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const prereqs = require('../src/prereqs');
const keystore = require('../src/keystore');
const { quoteWin } = require('../src/exec');
const buildMod = require('../src/build');

/* ------------------------------------------------------------- prereqs -- */

test('parses java -version output', () => {
  assert.equal(prereqs.parseJavaVersion('openjdk version "25" 2025-09-16'), '25');
  assert.equal(prereqs.parseJavaVersion('java version "1.8.0_411"'), '1.8.0_411');
  assert.equal(prereqs.parseJavaVersion('openjdk version "17.0.11" 2024-04-16'), '17.0.11');
  assert.equal(prereqs.parseJavaVersion('nothing useful'), null);
});

test('sorts SDK versions newest first', () => {
  const bt = ['33.0.1', '36.0.0', '34.0.0'].sort(prereqs.versionSort);
  assert.deepEqual(bt, ['36.0.0', '34.0.0', '33.0.1']);
  const plat = ['android-33', 'android-37', 'android-9'].sort(prereqs.versionSort);
  assert.deepEqual(plat, ['android-37', 'android-33', 'android-9']);
});

test('Android Studio JBR is preferred over PATH when JAVA_HOME is unset', () => {
  const saved = process.env.JAVA_HOME;
  delete process.env.JAVA_HOME;
  const cands = prereqs._internal.jdkCandidates();
  const idx = cands.findIndex((c) => /Android Studio/i.test(c.home));
  if (process.platform === 'win32') {
    assert.ok(idx >= 0, 'Android Studio JBR must be a candidate on Windows');
    assert.ok(idx <= 3, 'and near the front of the list');
  }
  if (saved !== undefined) process.env.JAVA_HOME = saved;
});

test('an explicit override always wins', () => {
  const cands = prereqs._internal.jdkCandidates('/tmp/my-jdk');
  assert.equal(cands[0].home, path.normalize('/tmp/my-jdk'));
  const sdks = prereqs._internal.sdkCandidates('/tmp/my-sdk');
  assert.equal(sdks[0].path, path.normalize('/tmp/my-sdk'));
});

test('toolchainEnv exports JAVA_HOME / ANDROID_HOME and puts the JDK first on PATH', () => {
  const env = prereqs.toolchainEnv(
    { home: '/opt/jdk' },
    { path: '/opt/sdk' },
  );
  assert.equal(env.JAVA_HOME, '/opt/jdk');
  assert.equal(env.ANDROID_HOME, '/opt/sdk');
  assert.equal(env.ANDROID_SDK_ROOT, '/opt/sdk');
  assert.ok(env.PATH.startsWith(path.join('/opt/jdk', 'bin')));
  assert.equal(env.Path, undefined, 'must not leave a duplicate lowercase-cased PATH key on Windows');
});

/* ------------------------------------------------------------ keystore -- */

const KEYTOOL_LIST_V = `Keystore type: PKCS12
Keystore provider: SUN

Your keystore contains 1 entry

Alias name: 2d9d7367781c909f80ceaeacb0e8f67d
Creation date: 12-Mar-2024
Entry type: PrivateKeyEntry
Certificate chain length: 1
Certificate[1]:
Owner: CN=Scanified
Issuer: CN=Scanified
Serial number: 1a2b3c
Valid from: Tue Mar 12 10:00:00 CST 2024 until: Sat Jul 28 10:00:00 CST 2054
Certificate fingerprints:
	 SHA1: 2F:23:50:65:5C:07:7A:BB:39:30:70:FD:65:39:B4:94:FA:89:12:70
	 SHA256: AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99
Signature algorithm name: SHA256withRSA
Subject Public Key Algorithm: 2048-bit RSA key
Version: 3
`;

test('reads fingerprints and validity out of keytool output', () => {
  const fp = keystore.parseFingerprints(KEYTOOL_LIST_V);
  assert.equal(fp.sha1, '2F:23:50:65:5C:07:7A:BB:39:30:70:FD:65:39:B4:94:FA:89:12:70');
  assert.equal(fp.alias, '2d9d7367781c909f80ceaeacb0e8f67d');
  assert.match(fp.validUntil, /2054/);
  assert.equal(fp.algorithm, 'SHA256withRSA');
});

test('finds aliases in both -list and -list -v output', () => {
  assert.deepEqual(keystore.parseAliases(KEYTOOL_LIST_V), ['2d9d7367781c909f80ceaeacb0e8f67d']);
  const short = `Keystore type: PKCS12\n\nYour keystore contains 2 entries\n\nupload, 12-Mar-2024, PrivateKeyEntry,\nold-key, 01-Jan-2020, PrivateKeyEntry,\n`;
  assert.deepEqual(keystore.parseAliases(short), ['upload', 'old-key']);
});

test('turns keytool noise into something a human can act on', () => {
  assert.match(keystore.friendlyKeytoolError('keytool error: java.io.IOException: Keystore was tampered with, or password was incorrect'), /Wrong keystore password/);
  assert.match(keystore.friendlyKeytoolError('keytool error: java.lang.Exception: Alias <nope> does not exist'), /alias does not exist/i);
  assert.match(keystore.friendlyKeytoolError('java.security.UnrecoverableKeyException: Cannot recover key'), /Wrong key password/);
});

test('builds a valid -dname and escapes separators', () => {
  assert.equal(
    keystore.buildDname({ commonName: 'Evan', organization: 'Evoo', country: 'CA' }),
    'CN=Evan, O=Evoo, C=CA',
  );
  assert.match(keystore.buildDname({ commonName: 'A, B' }), /CN=A\\, B/);
  assert.throws(() => keystore.buildDname({}), /common name/i);
});

/* ---------------------------------------------------------------- exec -- */

test('quotes Windows arguments containing spaces', () => {
  assert.equal(quoteWin('simple'), 'simple');
  assert.equal(quoteWin('C:\\Program Files\\Android\\Android Studio\\jbr\\bin\\keytool.exe'),
    '"C:\\Program Files\\Android\\Android Studio\\jbr\\bin\\keytool.exe"');
  assert.equal(quoteWin(''), '""');
});

/* --------------------------------------------------------------- build -- */

test('build targets map to the right gradle task and output folder', () => {
  assert.equal(buildMod.TARGETS.bundle.task, 'bundleRelease');
  assert.equal(buildMod.TARGETS.bundle.ext, '.aab');
  assert.deepEqual(buildMod.TARGETS.bundle.outDir, ['app', 'build', 'outputs', 'bundle', 'release']);
  assert.equal(buildMod.TARGETS.apk.task, 'assembleRelease');
  assert.equal(buildMod.TARGETS.apk.ext, '.apk');
  assert.deepEqual(buildMod.TARGETS.apk.outDir, ['app', 'build', 'outputs', 'apk', 'release']);
});

test('warns about JDK versions the Android Gradle Plugin does not officially support', () => {
  assert.equal(prereqs.jdkMajor('25'), 25);
  assert.equal(prereqs.jdkMajor('17.0.11'), 17);
  assert.equal(prereqs.jdkMajor('1.8.0_411'), 8);
  assert.equal(prereqs.jdkVersionWarning('17.0.11'), null);
  assert.equal(prereqs.jdkVersionWarning('21'), null);
  assert.match(prereqs.jdkVersionWarning('25'), /newer than the Android Gradle Plugin/);
  assert.match(prereqs.jdkVersionWarning('1.8.0_411'), /older than React Native/);
});

test('prefers a Gradle-compatible JDK over merely the newest one', () => {
  const ranked = prereqs.rankJdks([
    { home: '/jbr', version: '25.0.2' },
    { home: '/t17', version: '17.0.11' },
    { home: '/t21', version: '21.0.12' },
    { home: '/old', version: '1.8.0_411' },
  ]);
  assert.equal(ranked[0].home, '/t21', 'JDK 21 wins outright');
  assert.equal(ranked[1].home, '/t17', 'then 17');
  assert.equal(ranked[2].home, '/jbr', 'too-new beats too-old');
  assert.equal(ranked[3].home, '/old', 'JDK 8 last');
});

test('among too-new JDKs, picks the least-new', () => {
  const ranked = prereqs.rankJdks([
    { home: '/j25', version: '25' },
    { home: '/j23', version: '23' },
    { home: '/j24', version: '24' },
  ]);
  assert.equal(ranked[0].home, '/j23');
});

test('ranking is stable when versions tie', () => {
  const ranked = prereqs.rankJdks([
    { home: '/first', version: '21.0.1' },
    { home: '/second', version: '21.0.1' },
  ]);
  assert.equal(ranked[0].home, '/first');
});

test('unparseable versions sort last rather than winning by accident', () => {
  const ranked = prereqs.rankJdks([
    { home: '/mystery', version: 'unknown' },
    { home: '/j21', version: '21' },
  ]);
  assert.equal(ranked[0].home, '/j21');
});

test('disables crash-reporter uploads via the documented env switches', () => {
  assert.deepEqual(buildMod.symbolUploadEnv(true), {
    SENTRY_DISABLE_AUTO_UPLOAD: 'true',
    SENTRY_DISABLE_NATIVE_DEBUG_UPLOAD: 'true',
  });
  assert.deepEqual(buildMod.symbolUploadEnv(false), {}, 'opting in must not set anything');
});

/* ----------------------------------------------------------------- iOS -- */

const projectMod = require('../src/project');

test('prebuild targets the requested platform', () => {
  assert.deepEqual(projectMod.prebuildArgs('android'), ['--yes', 'expo', 'prebuild', '--platform', 'android']);
  assert.ok(projectMod.prebuildArgs('ios').includes('ios'));
  assert.ok(projectMod.prebuildArgs('all').includes('all'));
  assert.throws(() => projectMod.prebuildArgs('windows'), /Unknown platform/);
});

test('iOS prebuild skips pod install off macOS, since CocoaPods needs a Mac', () => {
  const ios = projectMod.prebuildArgs('ios');
  if (process.platform === 'darwin') {
    assert.ok(!ios.includes('--no-install'), 'on a Mac, let it install pods');
  } else {
    assert.ok(ios.includes('--no-install'), 'off a Mac, generating files must not attempt pod install');
  }
  assert.ok(!projectMod.prebuildArgs('android').includes('--no-install'),
    'android never needs the pod-install opt-out');
});

test('clean is passed through for either platform', () => {
  assert.ok(projectMod.prebuildArgs('android', true).includes('--clean'));
  assert.ok(projectMod.prebuildArgs('ios', true).includes('--clean'));
});

test('iOS project generation is refused on Windows, where Expo cannot do it', () => {
  assert.equal(projectMod.canPrebuild('android', 'win32').ok, true, 'android is fine anywhere');
  assert.equal(projectMod.canPrebuild('ios', 'darwin').ok, true);
  assert.equal(projectMod.canPrebuild('ios', 'linux').ok, true, 'Expo supports Linux for iOS files');

  const win = projectMod.canPrebuild('ios', 'win32');
  assert.equal(win.ok, false);
  assert.match(win.reason, /macOS or Linux/);
  assert.match(win.reason, /CI workflow/, 'the refusal names the way forward');
});

test('inspect() reports the app version as a string, not an object', () => {
  // Regression: attaching version-bump data as `info.version` clobbered this
  // and the UI rendered "Scanified v[object Object]".
  const fs = require('fs'); const os = require('os'); const p2 = require('path');
  const dir = fs.mkdtempSync(p2.join(os.tmpdir(), 'forge-name-'));
  fs.writeFileSync(p2.join(dir, 'package.json'), JSON.stringify({ name: 'scanified', version: '1.2.1', dependencies: { expo: '~54.0.0' } }));
  const info = projectMod.inspect(dir);
  assert.equal(typeof info.version, 'string');
  assert.equal(info.version, '1.2.1');
  fs.rmSync(dir, { recursive: true, force: true });
});

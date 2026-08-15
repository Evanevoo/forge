'use strict';
/**
 * Prerequisite detection: JDK (java + keytool) and the Android SDK.
 *
 * Forge deliberately does NOT require JAVA_HOME / ANDROID_HOME to be set as
 * system environment variables. It finds the toolchain itself (Android
 * Studio's bundled JBR is the normal case on Windows) and injects the right
 * environment into every child process it launches.
 */
const fs = require('fs');
const path = require('path');
const { run, IS_WIN } = require('./exec');

const EXE = IS_WIN ? '.exe' : '';

function exists(p) {
  try { return !!p && fs.existsSync(p); } catch (_) { return false; }
}
function isDir(p) {
  try { return !!p && fs.statSync(p).isDirectory(); } catch (_) { return false; }
}
function listDir(p) {
  try { return fs.readdirSync(p); } catch (_) { return []; }
}

/* ------------------------------------------------------------------ JDK -- */

function jdkCandidates(override) {
  const out = [];
  const push = (p, source) => { if (p) out.push({ home: path.normalize(p), source }); };

  push(override, 'chosen in Forge');
  push(process.env.JAVA_HOME, 'JAVA_HOME');

  if (IS_WIN) {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = process.env.LOCALAPPDATA || '';
    const home = process.env.USERPROFILE || '';

    // Android Studio's bundled JetBrains Runtime — the common case, and the
    // one confirmed present on this machine.
    push(path.join(pf, 'Android', 'Android Studio', 'jbr'), 'Android Studio (bundled JDK)');
    push(path.join(pf86, 'Android', 'Android Studio', 'jbr'), 'Android Studio (bundled JDK)');
    if (local) push(path.join(local, 'Programs', 'Android Studio', 'jbr'), 'Android Studio (bundled JDK)');
    if (local) push(path.join(local, 'Android', 'Android Studio', 'jbr'), 'Android Studio (bundled JDK)');

    for (const base of [path.join(pf, 'Java'), path.join(pf, 'Eclipse Adoptium'), path.join(pf, 'Microsoft'), path.join(pf, 'Zulu')]) {
      for (const name of listDir(base)) {
        if (/jdk/i.test(name) || /zulu/i.test(name)) push(path.join(base, name), 'installed JDK');
      }
    }
    if (home) {
      for (const name of listDir(path.join(home, '.jdks'))) {
        push(path.join(home, '.jdks', name), 'IDE-managed JDK (~/.jdks)');
      }
      if (isDir(path.join(home, 'Oracle_JDK-23'))) push(path.join(home, 'Oracle_JDK-23'), 'installed JDK');
    }
  } else {
    for (const base of ['/usr/lib/jvm', '/opt/java', '/Library/Java/JavaVirtualMachines']) {
      for (const name of listDir(base)) {
        const home = path.join(base, name);
        push(exists(path.join(home, 'Contents', 'Home')) ? path.join(home, 'Contents', 'Home') : home, 'system JDK');
      }
    }
  }
  return out;
}

function jdkShape(home) {
  const javaExe = path.join(home, 'bin', 'java' + EXE);
  const keytoolExe = path.join(home, 'bin', 'keytool' + EXE);
  return { home, javaExe, keytoolExe, hasJava: exists(javaExe), hasKeytool: exists(keytoolExe) };
}

function parseJavaVersion(text) {
  // `java -version` writes to stderr, e.g.  openjdk version "25" 2025-09-16
  const m = /(?:openjdk|java)\s+version\s+"([^"]+)"/i.exec(text || '');
  if (m) return m[1];
  const m2 = /(?:openjdk|java)\s+(\d+(?:\.\d+)*)/i.exec(text || '');
  return m2 ? m2[1] : null;
}

/**
 * Rank validated JDKs by how well the Android Gradle Plugin tolerates them.
 *
 * Picking "the newest JDK on the machine" is the wrong default: Android
 * Studio bundles a runtime far ahead of what Gradle can read, and the failure
 * ("Unsupported class file major version") happens minutes into a build with
 * no hint about the cause. Prefer a version AGP is actually tested against.
 */
function jdkScore(major) {
  if (major == null) return [3, 0];
  if (major >= 17 && major <= 21) return [0, -major]; // supported; prefer 21
  if (major > 21) return [1, major];                  // too new; prefer least-new
  return [2, -major];                                 // too old; prefer newest
}

function rankJdks(list) {
  return list
    .map((j, i) => ({ j, i, s: jdkScore(jdkMajor(j.version)) }))
    .sort((a, b) => (a.s[0] - b.s[0]) || (a.s[1] - b.s[1]) || (a.i - b.i))
    .map((x) => x.j);
}

async function detectJdk(override) {
  const tried = [];
  const valid = [];

  for (const cand of jdkCandidates(override).slice(0, 14)) {
    if (!isDir(cand.home)) { tried.push({ ...cand, why: 'not a directory' }); continue; }
    const shape = jdkShape(cand.home);
    if (!shape.hasJava) { tried.push({ ...cand, why: 'no bin/java' }); continue; }
    if (!shape.hasKeytool) { tried.push({ ...cand, why: 'no bin/keytool (JRE, not a JDK)' }); continue; }
    if (valid.some((v) => v.home === shape.home)) continue;

    const res = await run({ file: shape.javaExe, args: ['-version'], timeout: 30000 });
    const text = (res.stderr || '') + (res.stdout || '');
    if (res.code !== 0) { tried.push({ ...cand, why: 'java -version failed' }); continue; }

    valid.push({
      ok: true,
      home: shape.home,
      javaExe: shape.javaExe,
      keytoolExe: shape.keytoolExe,
      version: parseJavaVersion(text) || 'unknown',
      source: cand.source,
      raw: text.trim().split('\n')[0] || '',
    });
  }

  if (valid.length) {
    // An explicit choice in Forge always wins — never second-guess the user.
    const chosen = override ? valid.find((v) => v.source === 'chosen in Forge') : null;
    const ranked = rankJdks(valid);
    const best = chosen || ranked[0];
    return {
      ...best,
      tried,
      alternatives: valid.filter((v) => v.home !== best.home)
        .map((v) => ({ home: v.home, version: v.version, source: v.source })),
    };
  }

  // Last resort: whatever `java` is on PATH.
  const which = await run({ file: IS_WIN ? 'where' : 'which', args: ['java'], timeout: 15000 });
  if (which.code === 0) {
    const first = which.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first) {
      const home = path.dirname(path.dirname(first));
      const shape = jdkShape(home);
      if (shape.hasJava && shape.hasKeytool) {
        const res = await run({ file: shape.javaExe, args: ['-version'], timeout: 30000 });
        return {
          ok: res.code === 0,
          home,
          javaExe: shape.javaExe,
          keytoolExe: shape.keytoolExe,
          version: parseJavaVersion((res.stderr || '') + (res.stdout || '')) || 'unknown',
          source: 'PATH',
          raw: ((res.stderr || '') + (res.stdout || '')).trim().split('\n')[0] || '',
          tried,
        };
      }
    }
  }

  return {
    ok: false,
    tried,
    hint: IS_WIN
      ? 'No JDK found. Android Studio ships one at "C:\\Program Files\\Android\\Android Studio\\jbr" — install Android Studio, or point Forge at a JDK folder manually.'
      : 'No JDK found. Install a JDK (e.g. Temurin 17+) or point Forge at one manually.',
  };
}

/* ---------------------------------------------------------- Android SDK -- */

function sdkCandidates(override) {
  const out = [];
  const push = (p, source) => { if (p) out.push({ path: path.normalize(p), source }); };

  push(override, 'chosen in Forge');
  push(process.env.ANDROID_HOME, 'ANDROID_HOME');
  push(process.env.ANDROID_SDK_ROOT, 'ANDROID_SDK_ROOT');

  if (IS_WIN) {
    const local = process.env.LOCALAPPDATA || '';
    if (local) push(path.join(local, 'Android', 'Sdk'), 'default Android Studio SDK location');
    push('C:\\Android\\Sdk', 'common location');
    push('C:\\Android\\android-sdk', 'common location');
  } else {
    const home = process.env.HOME || '';
    if (home) {
      push(path.join(home, 'Android', 'Sdk'), 'default SDK location');
      push(path.join(home, 'Library', 'Android', 'sdk'), 'default SDK location');
    }
    push('/usr/lib/android-sdk', 'system SDK');
  }
  return out;
}

function versionSort(a, b) {
  const pa = String(a).split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d) return d;
  }
  return 0;
}

async function detectAndroidSdk(override) {
  const tried = [];
  for (const cand of sdkCandidates(override)) {
    if (!isDir(cand.path)) { tried.push({ ...cand, why: 'not a directory' }); continue; }

    const buildTools = listDir(path.join(cand.path, 'build-tools')).filter((n) => isDir(path.join(cand.path, 'build-tools', n))).sort(versionSort);
    const platforms = listDir(path.join(cand.path, 'platforms')).filter((n) => /^android-/.test(n)).sort(versionSort);
    const hasPlatformTools = isDir(path.join(cand.path, 'platform-tools'));
    const licenseFile = path.join(cand.path, 'licenses', 'android-sdk-license');
    const licensed = exists(licenseFile);

    if (!buildTools.length && !hasPlatformTools) {
      tried.push({ ...cand, why: 'no build-tools and no platform-tools' });
      continue;
    }

    const problems = [];
    if (!buildTools.length) problems.push('no build-tools installed');
    if (!platforms.length) problems.push('no platform (android-NN) installed');
    if (!licensed) problems.push('SDK licence not accepted (run sdkmanager --licenses)');

    return {
      ok: problems.length === 0,
      path: cand.path,
      source: cand.source,
      buildTools,
      platforms,
      hasPlatformTools,
      licensed,
      problems,
      tried,
    };
  }
  return {
    ok: false,
    tried,
    hint: IS_WIN
      ? 'No Android SDK found. Android Studio installs it at "%LOCALAPPDATA%\\Android\\Sdk" by default — or point Forge at an SDK folder manually.'
      : 'No Android SDK found. Install it via Android Studio or the command-line tools.',
  };
}

/**
 * Android Gradle Plugin / Gradle only officially support certain JDK versions.
 * A very new JDK usually still runs, but when it doesn't the error ("Unsupported
 * class file major version") is opaque, so say so up front.
 */
function jdkMajor(version) {
  if (!version) return null;
  const m = /^(?:1\.)?(\d+)/.exec(String(version));
  return m ? parseInt(m[1], 10) : null;
}

function jdkVersionWarning(version) {
  const major = jdkMajor(version);
  if (major == null) return null;
  if (major < 17) {
    return '\n! JDK ' + major + ' is older than React Native 0.7x requires — install JDK 17 or 21.';
  }
  if (major > 21) {
    return '\n! JDK ' + major + ' is newer than the Android Gradle Plugin supports, and no JDK 17-21'
      + '\n  was found on this machine. Gradle will fail with "Unsupported class file major version".'
      + '\n  Install one:  winget install --id EclipseAdoptium.Temurin.21.JDK -e'
      + '\n  then use "Set JDK folder..." above.';
  }
  return null;
}

/* -------------------------------------------------------------- Summary -- */

async function detectAll(overrides = {}) {
  const [jdk, sdk] = await Promise.all([
    detectJdk(overrides.jdk),
    detectAndroidSdk(overrides.sdk),
  ]);

  const node = {
    ok: true,
    version: process.versions.node,
    source: 'bundled with Forge (Electron)',
  };

  const checks = [
    {
      id: 'node',
      label: 'Node.js',
      ok: true,
      value: 'v' + node.version,
      detail: 'Bundled with Forge — no separate install needed for Forge itself.',
    },
    {
      id: 'jdk',
      label: 'Java JDK',
      ok: !!jdk.ok,
      value: jdk.ok ? ('JDK ' + jdk.version) : 'not found',
      detail: jdk.ok
        ? jdk.home + '  (' + jdk.source + ')' + (jdkVersionWarning(jdk.version) || '')
        : (jdk.hint || ''),
      path: jdk.home || null,
    },
    {
      id: 'keytool',
      label: 'keytool',
      ok: !!(jdk.ok && jdk.keytoolExe),
      value: jdk.ok ? 'available' : 'unavailable',
      detail: jdk.ok ? jdk.keytoolExe : 'Comes with the JDK — resolve the JDK first.',
      path: jdk.keytoolExe || null,
    },
    {
      id: 'sdk',
      label: 'Android SDK',
      ok: !!sdk.ok,
      value: sdk.path ? (sdk.problems && sdk.problems.length ? 'incomplete' : 'ready') : 'not found',
      detail: sdk.path
        ? sdk.path + '  (' + sdk.source + ')'
          + (sdk.buildTools && sdk.buildTools.length ? '\nbuild-tools: ' + sdk.buildTools.join(', ') : '')
          + (sdk.platforms && sdk.platforms.length ? '\nplatforms: ' + sdk.platforms.join(', ') : '')
          + (sdk.problems && sdk.problems.length ? '\nissues: ' + sdk.problems.join('; ') : '')
        : (sdk.hint || ''),
      path: sdk.path || null,
    },
  ];

  return {
    ok: checks.every((c) => c.ok),
    checks,
    jdk,
    sdk,
    node,
  };
}

/** Environment for every child process Forge launches. */
function toolchainEnv(jdk, sdk, extra = {}) {
  const env = { ...process.env, ...extra };
  if (jdk && jdk.home) {
    env.JAVA_HOME = jdk.home;
    const binDir = path.join(jdk.home, 'bin');
    env.PATH = binDir + path.delimiter + (env.PATH || env.Path || '');
    delete env.Path; // Windows: avoid a duplicate, differently-cased key
  }
  if (sdk && sdk.path) {
    env.ANDROID_HOME = sdk.path;
    env.ANDROID_SDK_ROOT = sdk.path;
    const ptools = path.join(sdk.path, 'platform-tools');
    if (exists(ptools)) env.PATH = ptools + path.delimiter + env.PATH;
  }
  return env;
}

module.exports = {
  detectAll,
  detectJdk,
  detectAndroidSdk,
  toolchainEnv,
  parseJavaVersion,
  versionSort,
  jdkMajor,
  jdkVersionWarning,
  rankJdks,
  jdkScore,
  _internal: { jdkCandidates, sdkCandidates, jdkShape },
};

'use strict';
/**
 * Project inspection and `expo prebuild`.
 */
const fs = require('fs');
const path = require('path');
const { stream, IS_WIN } = require('./exec');

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function findAppConfig(dir) {
  for (const name of ['app.json', 'app.config.js', 'app.config.ts']) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return { name, path: p, dynamic: name !== 'app.json' };
  }
  return null;
}

function applicationIdFromGradle(dir) {
  const file = path.join(dir, 'android', 'app', 'build.gradle');
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const m = /applicationId\s+["']([^"']+)["']/.exec(text) || /namespace\s+["']([^"']+)["']/.exec(text);
  return m ? m[1] : null;
}

function inspect(dir) {
  if (!dir || !fs.existsSync(dir)) {
    return { ok: false, error: 'Folder does not exist.' };
  }
  const pkgPath = path.join(dir, 'package.json');
  const pkg = readJsonSafe(pkgPath);
  if (!pkg) {
    return { ok: false, dir, error: 'No readable package.json here — this does not look like a JS project.' };
  }

  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const isExpo = !!deps.expo;
  const isReactNative = !!deps['react-native'];
  const appConfig = findAppConfig(dir);
  const appJson = appConfig && !appConfig.dynamic ? readJsonSafe(appConfig.path) : null;
  const expoBlock = appJson && appJson.expo ? appJson.expo : null;

  const androidDir = path.join(dir, 'android');
  const hasAndroid = fs.existsSync(androidDir);
  const iosDir = path.join(dir, 'ios');
  const hasIos = fs.existsSync(iosDir);
  // CocoaPods can't run on Windows, so a freshly generated ios/ folder has no
  // Pods yet. That's expected — the Mac that compiles it installs them.
  const hasPods = hasIos && fs.existsSync(path.join(iosDir, 'Pods'));
  const hasGradlew = fs.existsSync(path.join(androidDir, IS_WIN ? 'gradlew.bat' : 'gradlew'));
  const hasNodeModules = fs.existsSync(path.join(dir, 'node_modules'));

  const applicationId = (expoBlock && expoBlock.android && expoBlock.android.package)
    || applicationIdFromGradle(dir)
    || null;

  const warnings = [];
  if (!isExpo && !isReactNative) {
    warnings.push('Neither `expo` nor `react-native` is a dependency — Forge may not be able to build this.');
  }
  if (!hasNodeModules) {
    warnings.push('node_modules is missing. Run `npm install` in the project before prebuilding or building.');
  }
  if (hasAndroid && !hasGradlew) {
    warnings.push('An android/ folder exists but has no Gradle wrapper — it may be incomplete. Consider re-running prebuild.');
  }

  return {
    ok: true,
    dir,
    name: (expoBlock && expoBlock.name) || pkg.name || path.basename(dir),
    version: (expoBlock && expoBlock.version) || pkg.version || null,
    expoVersion: deps.expo || null,
    reactNativeVersion: deps['react-native'] || null,
    isExpo,
    isReactNative,
    appConfig: appConfig ? appConfig.name : null,
    appConfigDynamic: !!(appConfig && appConfig.dynamic),
    applicationId,
    hasAndroid,
    hasGradlew,
    hasIos,
    hasPods,
    hasNodeModules,
    needsPrebuild: !hasAndroid || !hasGradlew,
    warnings,
  };
}

/**
 * Run `npx expo prebuild --platform android`.
 * Returns { promise, cancel } — output is streamed via onLine.
 */
/**
 * Arguments for `npx expo prebuild`. Pure, so the platform handling is testable.
 *
 * `--no-install` for iOS is deliberate: prebuild would otherwise try to run
 * `pod install`, which needs CocoaPods and therefore a Mac. Generating the
 * project files works fine on Windows; installing the pods is the compiling
 * machine's job.
 */
/**
 * Can this machine generate the native project for `platform`?
 *
 * Expo CLI refuses to write iOS project files anywhere but macOS or Linux —
 * it prints "Skipping generating the iOS native project files" and then fails
 * with "At least one platform must be enabled when syncing". So on Windows the
 * honest answer is no, and running the command anyway just wastes a minute to
 * reach the same conclusion.
 */
function canPrebuild(platform, osPlatform = process.platform) {
  if (platform === 'android') return { ok: true };
  if (osPlatform === 'win32') {
    return {
      ok: false,
      reason: 'Expo cannot generate the iOS project on Windows — it only does that on macOS or Linux. '
        + 'Use "Add iOS CI workflow": the macOS runner generates ios/ and builds the .ipa in the same job, '
        + 'so nothing needs generating here.',
    };
  }
  return { ok: true };
}

function prebuildArgs(platform = 'android', clean = false) {
  if (!['android', 'ios', 'all'].includes(platform)) {
    throw new Error('Unknown platform: ' + platform);
  }
  const args = ['--yes', 'expo', 'prebuild', '--platform', platform];
  if (clean) args.push('--clean');
  if (platform !== 'android' && process.platform !== 'darwin') args.push('--no-install');
  return args;
}

function prebuild({ dir, env, onLine, clean = false, platform = 'android' }) {
  const args = prebuildArgs(platform, clean);
  return stream({
    file: IS_WIN ? 'npx.cmd' : 'npx',
    args,
    cwd: dir,
    env: { ...env, CI: '1', EXPO_NO_TELEMETRY: '1' },
    onLine,
  });
}

module.exports = { inspect, prebuild, prebuildArgs, canPrebuild, applicationIdFromGradle };

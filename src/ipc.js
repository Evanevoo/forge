'use strict';
/**
 * All main-process IPC handlers. The renderer has no Node access; everything
 * it can do is listed here.
 */
const fs = require('fs');
const path = require('path');
const { ipcMain, dialog, shell, app } = require('electron');

const prereqs = require('./prereqs');
const project = require('./project');
const keystore = require('./keystore');
const gradle = require('./gradle');
const build = require('./build');
const verify = require('./verify');
const license = require('./license');
const version = require('./version');
const publish = require('./publish');
const ios = require('./ios');
const store = require('./secrets');

/** Current long-running job, so it can be cancelled. */
let activeJob = null;

/** Attach the Gradle-side facts the renderer needs about a project. */
function decorateProject(info) {
  if (!info || !info.ok) return info;
  info.signing = gradle.inspectSigning(info.dir);
  info.memory = info.hasAndroid ? gradle.inspectJvmArgs(info.dir) : null;
  // Distinct name: info.version is already the app's version string.
  info.versionInfo = version.read(info.dir);
  return info;
}

function makeLogger(win, channel) {
  return (streamName, line) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('forge:log', { channel, stream: streamName, line });
    }
  };
}

function status(win, payload) {
  if (win && !win.isDestroyed()) win.webContents.send('forge:status', payload);
}

async function currentToolchain() {
  const settings = store.getSettings();
  const detected = await prereqs.detectAll({ jdk: settings.jdkOverride, sdk: settings.sdkOverride });
  return detected;
}

function register(getWindow) {
  const handle = (channel, fn) => {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        const result = await fn(...args);
        return { ok: true, result };
      } catch (err) {
        return { ok: false, error: (err && err.message) || String(err), raw: err && err.raw };
      }
    });
  };

  /* ---------------------------------------------------------------- app -- */

  handle('app:info', async () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    dataDir: store.paths.dir(),
    encryptionAvailable: store.encryptionAvailable(),
  }));

  handle('settings:get', async () => store.getSettings());
  handle('settings:set', async (patch) => store.setSettings(patch || {}));

  /* ------------------------------------------------------------ project -- */

  handle('project:pick', async () => {
    const win = getWindow();
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose an Expo / React Native project folder',
      properties: ['openDirectory'],
      defaultPath: store.getSettings().lastProject || undefined,
    });
    if (res.canceled || !res.filePaths.length) return null;
    const dir = res.filePaths[0];
    // Only remember a folder that actually is a project. Picking the wrong
    // folder must not silently replace the project you had selected.
    const info = project.inspect(dir);
    if (!info.ok) return info;
    store.setSettings({ lastProject: dir });
    return decorateProject(info);
  });

  handle('project:inspect', async (dir) => {
    const target = dir || store.getSettings().lastProject;
    if (!target) return null;
    const info = project.inspect(target);
    if (info.ok) store.setSettings({ lastProject: target });
    return decorateProject(info);
  });

  handle('project:prebuild', async ({ dir, clean = false, platform = 'android' } = {}) => {
    if (activeJob) throw new Error('Another task is already running.');
    const win = getWindow();
    // Forge does not depend on Expo. Prebuild exists only for projects that
    // already declare it and have no native folder yet.
    const before = project.inspect(dir);
    if (!before.ok) throw new Error(before.error || 'Cannot read that project.');
    if (!before.isExpo) {
      throw new Error('This project does not declare `expo`, so there is nothing for `expo prebuild` to do. '
        + 'Generate android/ with the React Native Community CLI and reopen the project — Forge builds it with Gradle alone.');
    }
    const supported = project.canPrebuild(platform);
    if (!supported.ok) throw new Error(supported.reason);

    const tools = await currentToolchain();
    if (!tools.jdk.ok) throw new Error('A JDK is required before prebuilding. ' + (tools.jdk.hint || ''));
    const env = prereqs.toolchainEnv(tools.jdk, tools.sdk);
    const onLine = makeLogger(win, 'prebuild');

    onLine('stdout', '[forge] npx expo prebuild --platform ' + platform + (clean ? ' --clean' : ''));
    if (platform !== 'android') {
      onLine('stdout', '[forge] note: iOS project files are generated here, but CocoaPods and Xcode');
      onLine('stdout', '[forge]       only run on macOS - a Mac (or a macOS CI runner) compiles the .ipa.');
    }
    onLine('stdout', '[forge] cwd: ' + dir);
    status(win, { job: 'prebuild', state: 'running' });

    const job = project.prebuild({ dir, env, onLine, clean, platform });
    activeJob = job;
    const res = await job.promise;
    activeJob = null;
    status(win, { job: 'prebuild', state: res.code === 0 ? 'done' : 'failed', code: res.code });
    if (res.code !== 0) {
      throw new Error(res.cancelled ? 'Prebuild cancelled.' : 'Prebuild failed (exit code ' + res.code + '). See the log.');
    }
    return project.inspect(dir);
  });

  /* -------------------------------------------------------------- tools -- */

  handle('env:detect', async () => currentToolchain());

  handle('env:pick', async (which) => {
    const win = getWindow();
    const res = await dialog.showOpenDialog(win, {
      title: which === 'jdk' ? 'Select a JDK folder (the one containing bin\\java)' : 'Select the Android SDK folder',
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths.length) return currentToolchain();
    const dir = res.filePaths[0];
    store.setSettings(which === 'jdk' ? { jdkOverride: dir } : { sdkOverride: dir });
    return currentToolchain();
  });

  handle('env:clearOverride', async (which) => {
    store.setSettings(which === 'jdk' ? { jdkOverride: null } : { sdkOverride: null });
    return currentToolchain();
  });

  /* ----------------------------------------------------------- keystore -- */

  handle('keystore:list', async () => ({
    keystores: store.listKeystores(),
    selectedId: store.getSettings().selectedKeystoreId,
    encryptionAvailable: store.encryptionAvailable(),
  }));

  handle('keystore:select', async (id) => store.setSettings({ selectedKeystoreId: id }));

  handle('keystore:pickFile', async () => {
    const win = getWindow();
    const res = await dialog.showOpenDialog(win, {
      title: 'Select an existing keystore',
      properties: ['openFile'],
      filters: [
        { name: 'Keystores', extensions: ['jks', 'keystore', 'p12', 'pfx'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  });

  handle('keystore:probe', async ({ file, storePassword }) => {
    const tools = await currentToolchain();
    if (!tools.jdk.ok) throw new Error('A JDK is required to read keystores. ' + (tools.jdk.hint || ''));
    return keystore.inspect({ jdk: tools.jdk, file, storePassword });
  });

  handle('keystore:import', async ({ file, storePassword, alias, keyPassword, label }) => {
    const tools = await currentToolchain();
    if (!tools.jdk.ok) throw new Error('A JDK is required to read keystores. ' + (tools.jdk.hint || ''));
    const info = await keystore.inspect({ jdk: tools.jdk, file, storePassword, alias });
    if (alias && info.aliases.length && !info.aliases.includes(alias)) {
      throw new Error('Alias "' + alias + '" is not in this keystore. Found: ' + info.aliases.join(', '));
    }

    // The key password is separate from the store password and is often
    // different. Prove it here — otherwise a wrong one is only discovered by
    // Gradle's very last task, after the whole app has compiled.
    const resolvedAlias = alias || info.alias;
    const resolvedKeyPassword = keyPassword || storePassword;
    const keyCheck = await keystore.verifyKeyPassword({
      jdk: tools.jdk, file, storePassword, alias: resolvedAlias, keyPassword: resolvedKeyPassword,
    });
    if (!keyCheck.ok) {
      throw new Error(
        (keyPassword
          ? 'The key password is wrong for alias "' + resolvedAlias + '".'
          : 'This key has its own password, different from the keystore password. Fill in the "Key password" field.')
        + ' (' + keyCheck.message + ')');
    }
    const saved = store.saveKeystore(
      {
        label: label || path.basename(file),
        path: file,
        alias: alias || info.alias,
        sha1: info.sha1,
        sha256: info.sha256,
        validUntil: info.validUntil,
        origin: 'imported',
      },
      { storePassword, keyPassword: keyPassword || storePassword },
    );
    store.setSettings({ selectedKeystoreId: saved.id });
    return { saved, info: { sha1: info.sha1, sha256: info.sha256, aliases: info.aliases, validUntil: info.validUntil } };
  });

  handle('keystore:generatePath', async (suggestedName) => {
    const win = getWindow();
    const res = await dialog.showSaveDialog(win, {
      title: 'Where should the new keystore be saved?',
      defaultPath: path.join(app.getPath('home'), suggestedName || 'upload-key.jks'),
      filters: [{ name: 'Java keystore', extensions: ['jks'] }],
    });
    if (res.canceled || !res.filePath) return null;
    return res.filePath;
  });

  handle('keystore:generate', async (opts) => {
    const tools = await currentToolchain();
    if (!tools.jdk.ok) throw new Error('A JDK is required to generate keystores. ' + (tools.jdk.hint || ''));
    const dname = keystore.buildDname(opts);
    const info = await keystore.generate({
      jdk: tools.jdk,
      file: opts.file,
      alias: opts.alias,
      storePassword: opts.storePassword,
      keyPassword: opts.keyPassword || opts.storePassword,
      dname,
      validityDays: opts.validityDays || 10950,
    });
    const saved = store.saveKeystore(
      {
        label: opts.label || path.basename(opts.file),
        path: opts.file,
        alias: opts.alias,
        sha1: info.sha1,
        sha256: info.sha256,
        validUntil: info.validUntil,
        origin: 'generated',
      },
      { storePassword: opts.storePassword, keyPassword: opts.keyPassword || opts.storePassword },
    );
    store.setSettings({ selectedKeystoreId: saved.id });
    return { saved, info: { sha1: info.sha1, sha256: info.sha256, validUntil: info.validUntil } };
  });

  handle('keystore:remove', async (id) => store.removeKeystore(id));

  handle('keystore:unlock', async ({ id, storePassword, keyPassword }) => {
    const rec = store.listKeystores().find((k) => k.id === id);
    if (!rec) throw new Error('Keystore not found.');
    const tools = await currentToolchain();
    await keystore.inspect({ jdk: tools.jdk, file: rec.path, storePassword, alias: rec.alias });
    const resolvedKeyPassword = keyPassword || storePassword;
    const keyCheck = await keystore.verifyKeyPassword({
      jdk: tools.jdk, file: rec.path, storePassword, alias: rec.alias, keyPassword: resolvedKeyPassword,
    });
    if (!keyCheck.ok) {
      throw new Error((keyPassword
        ? 'The key password is wrong.'
        : 'This key has its own password, different from the keystore password. Fill in the "Key password" field.')
        + ' (' + keyCheck.message + ')');
    }
    store.rememberSessionSecrets(id, { storePassword, keyPassword: resolvedKeyPassword });
    return true;
  });

  /* ------------------------------------------------------------- gradle -- */

  handle('gradle:status', async (dir) => gradle.inspectSigning(dir));

  handle('gradle:patch', async (dir) => {
    const res = gradle.applySigningConfig(dir);
    return { ...res, status: gradle.inspectSigning(dir) };
  });

  handle('gradle:fixMemory', async (dir) => {
    const res = gradle.ensureJvmArgs(dir);
    const win = getWindow();
    if (res.changed) {
      makeLogger(win, 'build')('stdout',
        '[forge] raised org.gradle.jvmargs to -Xmx' + res.heapMb + 'm -XX:MaxMetaspaceSize=' + res.metaspaceMb + 'm');
    }
    return { ...res, status: gradle.inspectJvmArgs(dir) };
  });

  /* -------------------------------------------------------------- build -- */

  /* ---------------------------------------------------------------- iOS -- */

  handle('ios:addWorkflow', async (dir) => {
    const info = project.inspect(dir);
    if (!info.ok) throw new Error(info.error || 'Cannot read that project.');
    const src = path.join(__dirname, '..', 'templates', 'ios-build.yml');
    const destDir = path.join(dir, '.github', 'workflows');
    const dest = path.join(destDir, 'ios-build.yml');
    fs.mkdirSync(destDir, { recursive: true });
    const existed = fs.existsSync(dest);
    fs.copyFileSync(src, dest);
    makeLogger(getWindow(), 'build')('stdout', '[forge] ' + (existed ? 'updated ' : 'added ') + dest);
    return { file: dest, existed };
  });

  /* --------------------------------------------------- iOS credentials -- */

  handle('ios:status', async (dir) => {
    const repo = dir ? ios.repoFromDir(dir) : null;
    return {
      ...ios.status(),
      repo,
      bundleId: dir ? ios.bundleId(dir) : null,
      hasToken: store.hasSecret('githubToken'),
      hasCertPassword: store.hasSecret('iosCertPassword'),
      encryption: store.encryptionAvailable(),
      workflowPresent: !!(dir && fs.existsSync(path.join(dir, '.github', 'workflows', ios.WORKFLOW_FILE))),
    };
  });

  handle('ios:setBundleId', async ({ dir, bundleId }) => {
    const res = ios.setBundleId(dir, bundleId);
    makeLogger(getWindow(), 'build')('stdout', '[forge] iOS bundle identifier set to ' + res.bundleId);
    return res;
  });

  handle('ios:createCsr', async ({ name, email, country, password, force }) => {
    const tools = await currentToolchain();
    if (!tools.keytool || !tools.keytool.ok) throw new Error('keytool was not found. Set the JDK folder in Prerequisites first.');
    const log = makeLogger(getWindow(), 'build');
    const res = await ios.createCsr({ keytool: tools.keytool.path, name, email, country, password, force });
    store.setSecret('iosCertPassword', password);
    log('stdout', '[forge] certificate request written to ' + res.csr);
    log('stdout', '[forge] upload that file at developer.apple.com → Certificates → + → Apple Distribution');
    return res;
  });

  handle('ios:pickCertificate', async () => {
    const res = await dialog.showOpenDialog(getWindow(), {
      title: 'Select the certificate Apple issued (.cer)',
      properties: ['openFile'],
      filters: [{ name: 'Apple certificate', extensions: ['cer', 'crt', 'pem'] }],
    });
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
  });

  handle('ios:pickProfile', async () => {
    const res = await dialog.showOpenDialog(getWindow(), {
      title: 'Select the provisioning profile',
      properties: ['openFile'],
      filters: [{ name: 'Provisioning profile', extensions: ['mobileprovision'] }],
    });
    if (res.canceled || !res.filePaths.length) return null;
    const dest = ios.paths().profile;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(res.filePaths[0], dest);
    makeLogger(getWindow(), 'build')('stdout', '[forge] provisioning profile stored in ' + ios.credentialsDir());
    return dest;
  });

  handle('ios:pickAscKey', async () => {
    const res = await dialog.showOpenDialog(getWindow(), {
      title: 'Select the App Store Connect API key (.p8)',
      properties: ['openFile'],
      filters: [{ name: 'App Store Connect key', extensions: ['p8'] }],
    });
    if (res.canceled || !res.filePaths.length) return null;
    const dest = ios.paths().ascKey;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(res.filePaths[0], dest);
    const keyId = ios.ascKeyIdFromFilename(res.filePaths[0]);
    if (keyId) store.setSecret('ascKeyId', keyId);
    return { path: dest, keyId };
  });

  handle('ios:installCertificate', async ({ cerPath, password }) => {
    const tools = await currentToolchain();
    if (!tools.keytool || !tools.keytool.ok) throw new Error('keytool was not found. Set the JDK folder in Prerequisites first.');
    const log = makeLogger(getWindow(), 'build');
    const pw = password || store.getSecret('iosCertPassword');
    if (!pw) throw new Error('The certificate password is not remembered — re-enter it.');
    const res = await ios.installCertificate({
      keytool: tools.keytool.path, cerPath, password: pw, onLine: (l) => log('stdout', '[forge] ' + l),
    });
    const desc = await ios.describeCertificate({ keytool: tools.keytool.path, password: pw });
    if (desc.ok && !desc.issuedByApple) {
      log('stderr', '[forge] warning: that certificate was not issued by Apple — the build will not sign.');
    }
    log('stdout', '[forge] signing certificate ready: ' + res.p12);
    return { ...res, certificate: desc };
  });

  handle('ios:secrets', async () => {
    const pw = store.getSecret('iosCertPassword');
    const tools = await currentToolchain();
    let teamId = null;
    if (pw && tools.keytool && tools.keytool.ok) {
      const desc = await ios.describeCertificate({ keytool: tools.keytool.path, password: pw });
      teamId = desc.ok ? desc.teamId : null;
    }
    let keychain = store.getSecret('iosKeychainPassword');
    if (!keychain) {
      keychain = ios.randomPassword();
      store.setSecret('iosKeychainPassword', keychain);
    }
    return ios.secretBundle({ teamId, certPassword: pw, keychainPassword: keychain, ascKeyId: store.getSecret('ascKeyId') });
  });

  /* --------------------------------------------------------- iOS build -- */

  handle('ios:setToken', async (token) => {
    const res = store.setSecret('githubToken', token);
    return { ...res, hasToken: store.hasSecret('githubToken') };
  });

  handle('ios:startBuild', async ({ dir, ref, configuration, testflight }) => {
    const token = store.getSecret('githubToken');
    if (!token) throw new Error('No GitHub token saved. Create a fine-grained token with Actions: read and write, and paste it above.');
    const repo = ios.repoFromDir(dir);
    if (!repo) throw new Error('This project has no GitHub remote — the macOS runner builds from GitHub, not from your disk.');
    const log = makeLogger(getWindow(), 'build');
    const since = Date.now();
    await ios.startBuild({ token, owner: repo.owner, repo: repo.repo, ref: ref || 'main', configuration, testflight });
    log('stdout', '[forge] asked GitHub to build ' + repo.owner + '/' + repo.repo + ' on ' + (ref || 'main'));
    // The dispatch endpoint returns 204 with no body, so poll briefly for the
    // run it created rather than guessing an id.
    let run = null;
    for (let i = 0; i < 10 && !run; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      run = await ios.findRun({ token, owner: repo.owner, repo: repo.repo, since });
    }
    if (run) log('stdout', '[forge] run #' + run.run_number + ' started — ' + run.html_url);
    return { repo, run: run ? { id: run.id, url: run.html_url, number: run.run_number } : null };
  });

  handle('ios:runStatus', async ({ dir, runId }) => {
    const token = store.getSecret('githubToken');
    const repo = ios.repoFromDir(dir);
    if (!token || !repo) throw new Error('Missing GitHub token or remote.');
    return ios.runStatus({ token, owner: repo.owner, repo: repo.repo, runId });
  });

  handle('ios:fetchArtifact', async ({ dir, runId }) => {
    const token = store.getSecret('githubToken');
    const repo = ios.repoFromDir(dir);
    if (!token || !repo) throw new Error('Missing GitHub token or remote.');
    const destDir = path.join(dir, 'build-output');
    fs.mkdirSync(destDir, { recursive: true });
    const res = await ios.downloadArtifact({ token, owner: repo.owner, repo: repo.repo, runId, destDir });
    makeLogger(getWindow(), 'build')('stdout', '[forge] downloaded ' + res.path);
    return res;
  });

  /* ------------------------------------------------------------ publish -- */

  handle('publish:pickServiceAccount', async () => {
    const res = await dialog.showOpenDialog(getWindow(), {
      title: 'Select the Google Play service-account JSON key',
      properties: ['openFile'],
      filters: [{ name: 'JSON key', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePaths.length) return null;
    const file = res.filePaths[0];
    const sa = publish.readServiceAccount(file);   // fails loudly on the wrong file
    store.setSettings({ playServiceAccount: file });
    return { file, clientEmail: sa.client_email };
  });

  handle('publish:play', async ({ dir, aabPath, track = 'internal', releaseNotes, draft = false } = {}) => {
    if (activeJob) throw new Error('Another task is already running.');
    const win = getWindow();
    const onLine = makeLogger(win, 'publish');
    const settings = store.getSettings();
    const info = project.inspect(dir);
    if (!info.ok) throw new Error(info.error || 'Cannot read that project.');
    if (!settings.playServiceAccount) throw new Error('Choose your Play service-account JSON key first.');

    status(win, { job: 'publish', state: 'running' });
    try {
      const res = await publish.publishToPlay({
        serviceAccountFile: settings.playServiceAccount,
        packageName: info.applicationId,
        aabPath, track, releaseNotes, draft,
        onProgress: (m) => onLine('stdout', '[forge] ' + m),
      });
      onLine('stdout', '[forge] done — version code ' + res.versionCode + ' is on the ' + res.track
        + ' track (' + res.status + ')');
      status(win, { job: 'publish', state: 'done' });
      return res;
    } catch (err) {
      onLine('stderr', '[forge] ' + err.message);
      status(win, { job: 'publish', state: 'failed' });
      throw err;
    }
  });

  /* ------------------------------------------------------------ version -- */

  handle('version:read', async (dir) => version.read(dir));
  handle('version:bump', async ({ dir, code, name } = {}) => {
    const res = version.bump(dir, { code, name });
    makeLogger(getWindow(), 'build')('stdout',
      '[forge] version ' + (res.before.versionName || '?') + ' (' + (res.before.versionCode ?? '?') + ')'
      + ' -> ' + (res.after.versionName || '?') + ' (' + (res.after.versionCode ?? '?') + ')'
      + (res.written.length ? '  updated: ' + res.written.map((f) => f.split(/[\\/]/).pop()).join(', ') : '  no change'));
    return res;
  });

  /* ------------------------------------------------------------ licence -- */

  handle('license:status', async () => license.status());
  handle('license:activate', async (key) => license.activate(key));
  handle('license:clear', async () => license.clear());

  /* -------------------------------------------------------------- build -- */

  handle('build:start', async ({ dir, target = 'bundle' } = {}) => {
    if (activeJob) throw new Error('Another task is already running.');

    // Checked before anything expensive starts, so nobody waits ten minutes
    // to be told they need a licence.
    const gate = license.canBuild();
    if (!gate.allowed) {
      const err = new Error(gate.reason);
      err.needsLicense = true;
      throw err;
    }

    const win = getWindow();
    const tools = await currentToolchain();
    if (!tools.jdk.ok) throw new Error('A JDK is required. ' + (tools.jdk.hint || ''));
    if (!tools.sdk.ok) throw new Error('A complete Android SDK is required. ' + (tools.sdk.hint || (tools.sdk.problems || []).join('; ')));

    const settings = store.getSettings();
    let signing = null;
    if (settings.selectedKeystoreId) {
      signing = store.getKeystoreSecrets(settings.selectedKeystoreId);
      if (!signing) {
        throw new Error('The selected keystore is locked — enter its password again to unlock it for this session.');
      }
      if (!fs.existsSync(signing.path)) {
        throw new Error('Keystore file is missing: ' + signing.path);
      }
      const sig = gradle.inspectSigning(dir);
      if (!sig.patched) gradle.applySigningConfig(dir);
    }

    const env = prereqs.toolchainEnv(tools.jdk, tools.sdk);
    const onLine = makeLogger(win, 'build');

    // Say this before Gradle buries it: a too-small metaspace fails minutes
    // later with an error that never mentions memory.
    const mem = gradle.inspectJvmArgs(dir);
    if (mem.exists && !mem.ok) {
      for (const reason of mem.reasons) onLine('stderr', '[forge] warning: ' + reason);
      onLine('stderr', '[forge] this build may fail with "OutOfMemoryError: Metaspace" — use "Fix build memory" in the Project card.');
    }

    status(win, { job: 'build', state: 'running', target });

    const job = build.runBuild({
      projectDir: dir, target, env, sdk: tools.sdk, signing, onLine,
      skipSymbolUploads: settings.skipSymbolUploads !== false,
    });
    activeJob = job;
    const res = await job.promise;
    activeJob = null;

    status(win, {
      job: 'build',
      state: res.code === 0 ? 'done' : (res.cancelled ? 'cancelled' : 'failed'),
      code: res.code,
      artifact: res.artifact,
      durationMs: res.durationMs,
    });

    if (res.code !== 0) {
      throw new Error(res.cancelled ? 'Build cancelled.' : 'Build failed (exit code ' + res.code + '). See the log.');
    }
    if (!res.artifact) {
      throw new Error('Gradle succeeded but no ' + build.TARGETS[target].ext + ' was found in the expected output folder.');
    }
    // Don't take Gradle's word for it — read the signature back off the file.
    const expectedSha1 = signing
      ? (store.listKeystores().find((k) => k.id === settings.selectedKeystoreId) || {}).sha1
      : null;
    const signature = await verify.verifyArtifact({
      file: res.artifact.file, sdk: tools.sdk, jdk: tools.jdk, expectedSha1,
    });
    onLine(signature.matchesKey === false ? 'stderr' : 'stdout', '[forge] ' + signature.message);

    // A trial build is only spent once it has actually produced an artifact.
    const licenseStatus = license.recordSuccessfulBuild();

    return {
      artifact: res.artifact,
      durationMs: res.durationMs,
      signed: !!signing,
      signature,
      license: licenseStatus,
    };
  });

  handle('build:cancel', async () => {
    if (!activeJob) return false;
    activeJob.cancel();
    return true;
  });

  handle('build:clean', async ({ dir } = {}) => {
    if (activeJob) throw new Error('Another task is already running.');
    const win = getWindow();
    const tools = await currentToolchain();
    const env = prereqs.toolchainEnv(tools.jdk, tools.sdk);
    const job = build.runClean({ projectDir: dir, env, onLine: makeLogger(win, 'build') });
    activeJob = job;
    const res = await job.promise;
    activeJob = null;
    return res.code === 0;
  });

  /* -------------------------------------------------------------- shell -- */

  handle('shell:reveal', async (target) => {
    if (!target || !fs.existsSync(target)) throw new Error('Path no longer exists: ' + target);
    shell.showItemInFolder(target);
    return true;
  });

  handle('shell:openPath', async (target) => {
    const err = await shell.openPath(target);
    if (err) throw new Error(err);
    return true;
  });
}

module.exports = { register, hasActiveJob: () => !!activeJob };

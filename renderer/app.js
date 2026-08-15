'use strict';
/* Renderer. No Node access — everything goes through window.forge (preload). */

const $ = (id) => document.getElementById(id);
const state = {
  project: null,
  tools: null,
  keystores: [],
  selectedKeystoreId: null,
  busy: false,
  probe: null,
  lastArtifact: null,
  saFile: null,
};

/* ----------------------------------------------------------------- log -- */

const logEl = $('log');
const MAX_LOG_LINES = 5000;

function appendLog(line, kind) {
  const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
  const span = document.createElement('span');
  let cls = '';
  if (kind === 'stderr') cls = 'l-err';
  if (/^\[forge\]/.test(line)) cls = 'l-forge';
  if (/^BUILD SUCCESSFUL/.test(line)) cls = 'l-ok';
  if (/^(FAILURE|BUILD FAILED)/.test(line)) cls = 'l-err';
  if (cls) span.className = cls;
  span.textContent = line + '\n';
  logEl.appendChild(span);
  while (logEl.childNodes.length > MAX_LOG_LINES) logEl.removeChild(logEl.firstChild);
  if (atBottom) logEl.scrollTop = logEl.scrollHeight;
}
function logForge(msg) { appendLog('[forge] ' + msg, 'stdout'); }

window.forge.onLog(({ stream, line }) => appendLog(line, stream));
window.forge.onStatus((s) => {
  const badge = $('jobState');
  badge.className = 'badge ' + (s.state === 'running' ? 'running' : s.state === 'done' ? 'done' : s.state === 'failed' ? 'failed' : 'idle');
  badge.textContent = s.state === 'running' ? (s.job + '…') : s.state;
  setBusy(s.state === 'running');
});

$('btnClearLog').onclick = () => { logEl.textContent = ''; };
$('btnCopyLog').onclick = async () => {
  try { await navigator.clipboard.writeText(logEl.textContent); logForge('log copied to clipboard'); }
  catch (_) { logForge('could not access the clipboard'); }
};

/* ---------------------------------------------------------------- util -- */

function setBusy(busy) {
  state.busy = busy;
  for (const id of ['btnBuild', 'btnPrebuild', 'btnPrebuildClean', 'btnPrebuildIos', 'btnIosWorkflow', 'btnClean', 'btnPickProject', 'btnImportKs', 'btnGenKs']) {
    const el = $(id);
    if (el) el.disabled = busy;
  }
  $('btnCancel').classList.toggle('hidden', !busy);
}

async function call(fn, ...args) {
  const res = await fn(...args);
  if (!res || res.ok !== true) {
    const message = (res && res.error) || 'Unknown error';
    throw new Error(message);
  }
  return res.result;
}

function fmtBytes(n) {
  if (!n) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return v.toFixed(v < 10 && i > 0 ? 1 : 0) + ' ' + units[i];
}
function fmtDuration(ms) {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's';
}

/* -------------------------------------------------------------- render -- */

function showProjectError(message) {
  const el = $('projectError');
  if (!message) { el.classList.add('hidden'); return; }
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(showProjectError._t);
  showProjectError._t = setTimeout(() => el.classList.add('hidden'), 9000);
}

function renderProject() {
  const p = state.project;
  $('projectEmpty').classList.toggle('hidden', !!(p && p.ok));
  $('projectInfo').classList.toggle('hidden', !(p && p.ok));
  if (!p || !p.ok) return;

  $('pName').textContent = p.name + (typeof p.version === 'string' ? ' v' + p.version : '');
  $('pDir').textContent = p.dir;
  $('pAppId').textContent = p.applicationId || '(unknown — set expo.android.package in app.json)';
  $('pVersions').textContent = [
    p.expoVersion ? 'expo ' + p.expoVersion : null,
    p.reactNativeVersion ? 'react-native ' + p.reactNativeVersion : null,
  ].filter(Boolean).join('   ·   ') || '—';
  $('pIos').innerHTML = p.hasIos
    ? '<span style="color:var(--ok)">present</span>'
      + (p.hasPods ? '' : ' <span class="muted small">— Pods not installed (a Mac does that)</span>')
    : '<span class="muted">not generated</span>';
  $('pAndroid').innerHTML = p.hasAndroid
    ? '<span style="color:var(--ok)">present' + (p.hasGradlew ? ' (Gradle wrapper OK)' : ' — no wrapper') + '</span>'
    : '<span style="color:var(--warn)">missing — prebuild required</span>';

  const w = $('pWarnings');
  w.innerHTML = '';
  for (const msg of p.warnings || []) {
    const d = document.createElement('div');
    d.textContent = msg;
    w.appendChild(d);
  }
  // Prebuild is an Expo-only escape hatch for projects that have never had a
  // native folder. Forge's own pipeline never needs Expo: a React Native
  // project from the Community CLI ships android/ in the repo.
  $('prebuildGroup').classList.toggle('hidden', !p.isExpo);
  // Expo only writes iOS project files on macOS or Linux, so on Windows this
  // button would always fail. Say so on the button rather than in an error.
  const winIos = state.platform === 'win32';
  $('btnPrebuildIos').textContent = winIos ? 'Generate ios/ (macOS or Linux only)' : 'Generate ios/';
  $('btnPrebuildIos').classList.toggle('ghost', true);
  $('btnPrebuildIos').disabled = winIos;
  $('btnPrebuildIos').title = winIos
    ? 'Expo cannot generate iOS project files on Windows. The macOS CI runner does it as part of the build.'
    : 'Generates the ios/ project. Compiling it still requires a Mac.';
  $('btnPrebuild').textContent = p.hasAndroid ? 'Re-run prebuild' : 'Run prebuild';
  $('prebuildNote').textContent = p.isExpo
    ? 'This project declares expo, so `expo prebuild` is offered as a one-time way to generate android/. Once that folder exists and is committed, Forge builds it with Gradle alone and never calls Expo again.'
    : (p.hasAndroid
      ? 'No Expo in this project — Forge builds android/ with Gradle directly.'
      : 'No android/ folder and no Expo dependency. A React Native project normally has android/ committed — generate it with the React Native Community CLI, then reopen it here.');
  renderMemoryWarning();
  renderVersion();
  renderGradleStatus();
}

function renderMemoryWarning() {
  const p = state.project;
  const m = p && p.memory;
  const show = !!(m && m.exists && !m.ok);
  $('memWarn').classList.toggle('hidden', !show);
  if (!show) return;
  $('memWarnText').textContent =
    'Gradle build memory is too low — ' + m.reasons.join('; ') + '. '
    + 'This surfaces late, as "OutOfMemoryError: Metaspace" or a vanished daemon. '
    + 'Forge can raise it to -Xmx' + m.recommended.heapMb + 'm / MaxMetaspaceSize='
    + m.recommended.metaspaceMb + 'm (backed up first).';
}

function renderVersion() {
  const v = state.project && state.project.versionInfo;
  const row = $('versionRow');
  if (!v || !v.current || v.current.versionCode == null) {
    row.classList.add('hidden');
    return;
  }
  row.classList.remove('hidden');
  $('vCurrent').textContent = (v.current.versionName || '?') + '  ·  build ' + v.current.versionCode;
  $('vSync').textContent = v.inSync ? '' : '— app.json and build.gradle disagree; bumping will align them';
}

$('btnBump').onclick = async () => {
  if (!requireProject('bump the version')) return;
  try {
    const res = await call(window.forge.version.bump, {
      dir: state.project.dir, code: 'increment', name: $('vName').value,
    });
    logForge('version ' + (res.before.versionName || '?') + ' (' + res.before.versionCode + ') -> '
      + (res.after.versionName || '?') + ' (' + res.after.versionCode + ')');
    await refreshProject(state.project.dir);
  } catch (e) { logForge('version error: ' + e.message); }
};

function renderGradleStatus() {
  const el = $('gradleStatus');
  const p = state.project;
  if (!p || !p.ok || !p.hasAndroid) {
    el.textContent = 'Gradle signing config: waiting for an android/ folder.';
    return;
  }
  const s = p.signing || {};
  if (!s.exists) {
    el.innerHTML = 'Gradle signing config: <b>android/app/build.gradle not found</b>.';
    return;
  }
  el.innerHTML = s.patched
    ? 'Gradle signing config: <b style="color:var(--ok)">injected</b> — release builds use <code>signingConfigs.forgeRelease</code>, credentials passed through the environment at build time.'
    : 'Gradle signing config: <b style="color:var(--warn)">not yet injected</b> — Forge will patch <code>android/app/build.gradle</code> automatically on the first signed build (idempotent, backed up once).';
}

function renderChecks() {
  const list = $('checkList');
  list.innerHTML = '';
  if (!state.tools) return;
  for (const c of state.tools.checks) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot ' + (c.ok ? 'ok' : 'bad');
    dot.textContent = c.ok ? '●' : '●';
    const wrap = document.createElement('div');
    const label = document.createElement('div');
    label.className = 'label';
    label.innerHTML = '<b>' + c.label + '</b> — ' + c.value;
    const detail = document.createElement('div');
    detail.className = 'detail';
    detail.textContent = c.detail || '';
    wrap.appendChild(label);
    if (c.detail) wrap.appendChild(detail);
    li.appendChild(dot);
    li.appendChild(wrap);
    list.appendChild(li);
  }
}

function renderKeystores() {
  const list = $('ksList');
  list.innerHTML = '';
  $('ksEmpty').classList.toggle('hidden', state.keystores.length > 0);

  for (const k of state.keystores) {
    const li = document.createElement('li');
    if (k.id === state.selectedKeystoreId) li.classList.add('selected');

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'ks';
    radio.checked = k.id === state.selectedKeystoreId;
    radio.onchange = async () => {
      await call(window.forge.keystore.select, k.id);
      state.selectedKeystoreId = k.id;
      renderKeystores();
    };

    const main = document.createElement('div');
    main.className = 'ks-main';

    const title = document.createElement('div');
    title.className = 'ks-title';
    title.appendChild(document.createTextNode(k.label));
    if (k.origin === 'generated') title.appendChild(pill('generated', 'gen'));
    if (k.missing) title.appendChild(pill('file missing', 'missing'));
    if (!k.hasStoredPassword) title.appendChild(pill('locked', 'locked'));

    const sub = document.createElement('div');
    sub.className = 'ks-sub';
    sub.textContent = [
      k.path,
      'alias: ' + (k.alias || '?'),
      k.sha1 ? 'SHA1: ' + k.sha1 : null,
      k.validUntil ? 'valid until ' + k.validUntil : null,
    ].filter(Boolean).join('\n');

    main.appendChild(title);
    main.appendChild(sub);

    const actions = document.createElement('div');
    actions.className = 'row gap';
    if (!k.hasStoredPassword) {
      const unlock = document.createElement('button');
      unlock.className = 'btn small';
      unlock.textContent = 'Unlock';
      unlock.onclick = () => openUnlock(k);
      actions.appendChild(unlock);
    }
    const del = document.createElement('button');
    del.className = 'btn ghost small';
    del.textContent = 'Remove';
    del.onclick = async () => {
      await call(window.forge.keystore.remove, k.id);
      await refreshKeystores();
      logForge('removed keystore entry "' + k.label + '" (the .jks file itself was not deleted)');
    };
    actions.appendChild(del);

    li.appendChild(radio);
    li.appendChild(main);
    li.appendChild(actions);
    list.appendChild(li);
  }
}

function pill(text, cls) {
  const s = document.createElement('span');
  s.className = 'pill ' + (cls || '');
  s.textContent = text;
  return s;
}

/* ------------------------------------------------------------ refresh -- */

async function refreshTools() {
  state.tools = await call(window.forge.env.detect);
  renderChecks();
}

async function refreshProject(dir) {
  const info = await call(window.forge.project.inspect, dir);
  state.project = info;
  renderProject();
  // Defined further down; guarded because refreshProject also runs at startup
  // before the iOS section has attached its handlers.
  if (typeof refreshIos === 'function') await refreshIos();
}

async function refreshKeystores() {
  const res = await call(window.forge.keystore.list);
  state.keystores = res.keystores;
  state.selectedKeystoreId = res.selectedId;
  renderKeystores();
}

/* ------------------------------------------------------------ actions -- */

$('btnPickProject').onclick = async () => {
  try {
    const info = await call(window.forge.project.pick);
    if (!info) return;
    if (!info.ok) {
      // Don't discard a project that was already loaded just because the user
      // pointed the picker somewhere else (a JDK folder, a keystore folder…).
      const msg = 'That folder is not a project — ' + (info.error || 'no package.json found')
        + ' Pick the folder containing your package.json.'
        + (state.project && state.project.ok ? ' Keeping ' + state.project.name + '.' : '');
      showProjectError(msg);
      logForge('not a project: ' + (info.dir || '') + ' — ' + (info.error || ''));
      return;
    }
    showProjectError(null);
    state.project = info;
    await refreshProject(info.dir);
    logForge('project: ' + info.dir);
  } catch (e) { logForge('error: ' + e.message); }
};

$('btnRefreshProject').onclick = () => refreshProject().catch((e) => logForge('error: ' + e.message));

/**
 * Buttons that need a project must say so. A bare `return` makes the app look
 * broken — the user clicks, nothing happens, and there is nothing to report.
 */
function requireProject(what) {
  if (state.project && state.project.ok) return true;
  logForge('nothing to ' + what + ' — choose a project folder first (card 1).');
  showProjectError('Choose a project folder first, then ' + what + '.');
  return false;
}

async function doPrebuild(clean, platform = 'android') {
  if (!requireProject(platform === 'ios' ? 'generate ios/' : 'prebuild')) return;
  if (platform === 'ios' && !state.project.isExpo) {
    logForge('this project does not declare expo, so there is no prebuild to run for iOS.');
    return;
  }
  logForge('starting ' + (platform === 'ios' ? 'ios/ generation' : 'prebuild') + '…');
  try {
    setBusy(true);
    const info = await call(window.forge.project.prebuild, { dir: state.project.dir, clean, platform });
    state.project = info;
    await refreshProject(info.dir);
    logForge(platform === 'ios'
      ? 'ios/ generated. Forge cannot compile it — Xcode is macOS-only. Commit the folder and build it on a Mac or a macOS CI runner.'
      : 'prebuild finished — android/ is ready');
  } catch (e) {
    logForge('prebuild error: ' + e.message);
  } finally {
    setBusy(false);
  }
}
$('btnPrebuild').onclick = () => doPrebuild(false, 'android');
$('btnPrebuildClean').onclick = () => doPrebuild(true, 'android');
$('btnPrebuildIos').onclick = () => doPrebuild(false, 'ios');

$('btnIosWorkflow').onclick = async () => {
  if (!requireProject('add the iOS workflow')) return;
  try {
    const r = await call(window.forge.ios.addWorkflow, state.project.dir);
    logForge((r.existed ? 'updated ' : 'added ') + r.file);
    logForge('commit and push it, then run "iOS build" from the repo\'s Actions tab. '
      + 'It needs the signing secrets listed at the top of that file.');
  } catch (e) { logForge('workflow error: ' + e.message); }
};

$('btnFixMemory').onclick = async () => {
  if (!requireProject('fix build memory')) return;
  try {
    const res = await call(window.forge.gradle.fixMemory, state.project.dir);
    logForge(res.changed
      ? 'android/gradle.properties updated — heap ' + res.heapMb + ' MB, metaspace ' + res.metaspaceMb + ' MB'
      : 'build memory was already sufficient');
    await refreshProject(state.project.dir);
  } catch (e) { logForge('error: ' + e.message); }
};

$('btnRecheck').onclick = () => refreshTools().catch((e) => logForge('error: ' + e.message));
$('btnPickJdk').onclick = async () => { state.tools = await call(window.forge.env.pick, 'jdk'); renderChecks(); };
$('btnPickSdk').onclick = async () => { state.tools = await call(window.forge.env.pick, 'sdk'); renderChecks(); };

$('btnBuild').onclick = async () => {
  if (!requireProject('build')) return;
  if (!state.project.hasAndroid) { logForge('no android/ folder — run prebuild first'); return; }
  const target = document.querySelector('input[name=target]:checked').value;
  $('artifact').classList.add('hidden');
  try {
    setBusy(true);
    const res = await call(window.forge.build.start, { dir: state.project.dir, target });
    $('artifact').classList.remove('hidden');
    $('artifactPath').textContent = res.artifact.file;
    const sig = res.signature || {};
    $('artifactMeta').textContent = [
      fmtBytes(res.artifact.size),
      fmtDuration(res.durationMs),
      sig.checked
        ? (sig.matchesKey === true ? 'signature verified'
          : sig.matchesKey === false ? 'WRONG KEY'
            : sig.signed ? 'signed' : 'UNSIGNED')
        : (res.signed ? 'signed' : 'UNSIGNED'),
    ].filter(Boolean).join('  ·  ');
    const art = $('artifact');
    art.classList.toggle('bad', sig.matchesKey === false || sig.signed === false);
    $('artifactSig').textContent = sig.message || '';
    $('artifactSig').classList.toggle('hidden', !sig.message);
    $('btnReveal').onclick = () => call(window.forge.shell.reveal, res.artifact.file).catch((e) => logForge(e.message));
    state.lastArtifact = res.artifact;
    renderPublish();
    logForge('artifact: ' + res.artifact.file);
    await refreshProject(state.project.dir);
    await refreshLicense();
  } catch (e) {
    logForge('build error: ' + e.message);
    if (/licence key|trial builds/i.test(e.message)) openLicense();
  } finally {
    setBusy(false);
  }
};

$('btnCancel').onclick = async () => {
  await call(window.forge.build.cancel);
  logForge('cancellation requested');
};

$('btnClean').onclick = async () => {
  if (!requireProject('clean')) return;
  try {
    setBusy(true);
    await call(window.forge.build.clean, { dir: state.project.dir });
    logForge('gradle clean finished');
  } catch (e) { logForge('clean error: ' + e.message); }
  finally { setBusy(false); }
};

/* ------------------------------------------------------------- modals -- */

function openModal(id) {
  $('modalBackdrop').classList.remove('hidden');
  for (const m of document.querySelectorAll('.modal')) m.classList.add('hidden');
  $(id).classList.remove('hidden');
}
function closeModal() {
  $('modalBackdrop').classList.add('hidden');
  for (const m of document.querySelectorAll('.modal')) m.classList.add('hidden');
}
for (const btn of document.querySelectorAll('[data-close]')) btn.onclick = closeModal;
$('modalBackdrop').onclick = (e) => { if (e.target === $('modalBackdrop')) closeModal(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/* --- import --- */
$('btnImportKs').onclick = () => {
  $('impError').textContent = '';
  $('impProbeMsg').textContent = '';
  $('impFingerprint').classList.add('hidden');
  $('impAlias').innerHTML = '<option value="">— read the keystore first —</option>';
  $('btnDoImport').disabled = true;
  state.probe = null;
  openModal('modalImport');
};

$('btnBrowseKs').onclick = async () => {
  const p = await call(window.forge.keystore.pickFile);
  if (p) $('impPath').value = p;
};

$('btnProbe').onclick = async () => {
  $('impError').textContent = '';
  $('impProbeMsg').textContent = 'reading…';
  try {
    const info = await call(window.forge.keystore.probe, {
      file: $('impPath').value.trim(),
      storePassword: $('impStorePass').value,
    });
    state.probe = info;
    const sel = $('impAlias');
    sel.innerHTML = '';
    for (const a of info.aliases.length ? info.aliases : [info.alias].filter(Boolean)) {
      const o = document.createElement('option');
      o.value = a; o.textContent = a;
      sel.appendChild(o);
    }
    $('impProbeMsg').textContent = info.aliases.length + ' alias(es) found';
    $('impFingerprint').classList.remove('hidden');
    $('impFingerprint').textContent = [
      'SHA1   : ' + (info.sha1 || '—'),
      'SHA256 : ' + (info.sha256 || '—'),
      'Valid  : ' + (info.validUntil || '—'),
      '',
      'Check SHA1 against Google Play Console → Setup → App integrity → Upload key certificate.',
    ].join('\n');
    $('btnDoImport').disabled = false;
  } catch (e) {
    $('impProbeMsg').textContent = '';
    $('impError').textContent = e.message;
  }
};

$('btnDoImport').onclick = async () => {
  $('impError').textContent = '';
  try {
    const res = await call(window.forge.keystore.import, {
      file: $('impPath').value.trim(),
      storePassword: $('impStorePass').value,
      alias: $('impAlias').value,
      keyPassword: $('impKeyPass').value || undefined,
    });
    closeModal();
    await refreshKeystores();
    logForge('imported keystore "' + res.saved.label + '" (alias ' + res.saved.alias + ', SHA1 ' + (res.info.sha1 || '?') + ')');
  } catch (e) {
    $('impError').textContent = e.message;
  }
};

/* --- generate --- */
$('btnGenKs').onclick = () => { $('genError').textContent = ''; openModal('modalGen'); };
$('btnGenBrowse').onclick = async () => {
  const p = await call(window.forge.keystore.generatePath, 'upload-key.jks');
  if (p) $('genPath').value = p;
};
$('btnDoGen').onclick = async () => {
  $('genError').textContent = '';
  const pass = $('genStorePass').value;
  if (pass.length < 6) { $('genError').textContent = 'Password must be at least 6 characters.'; return; }
  if (pass !== $('genStorePass2').value) { $('genError').textContent = 'Passwords do not match.'; return; }
  if (!$('genPath').value.trim()) { $('genError').textContent = 'Choose where to save the keystore.'; return; }
  if (!$('genCN').value.trim()) { $('genError').textContent = 'A common name (CN) is required.'; return; }
  try {
    const res = await call(window.forge.keystore.generate, {
      file: $('genPath').value.trim(),
      alias: $('genAlias').value.trim() || 'upload',
      storePassword: pass,
      validityDays: parseInt($('genValidity').value, 10) || 10950,
      commonName: $('genCN').value.trim(),
      organization: $('genO').value.trim(),
      locality: $('genL').value.trim(),
      country: $('genC').value.trim(),
    });
    closeModal();
    await refreshKeystores();
    logForge('generated keystore — SHA1 ' + (res.info.sha1 || '?'));
  } catch (e) {
    $('genError').textContent = e.message;
  }
};

/* --- unlock --- */
let unlockTarget = null;
function openUnlock(k) {
  unlockTarget = k;
  $('unlError').textContent = '';
  $('unlStorePass').value = '';
  $('unlKeyPass').value = '';
  $('unlockWhich').textContent = k.label + '  ·  alias ' + (k.alias || '?');
  openModal('modalUnlock');
}
$('btnDoUnlock').onclick = async () => {
  $('unlError').textContent = '';
  try {
    await call(window.forge.keystore.unlock, {
      id: unlockTarget.id,
      storePassword: $('unlStorePass').value,
      keyPassword: $('unlKeyPass').value || undefined,
    });
    closeModal();
    await refreshKeystores();
    logForge('keystore unlocked for this session');
  } catch (e) {
    $('unlError').textContent = e.message;
  }
};

/* ------------------------------------------------------------ publish -- */

function renderPublish() {
  const a = state.lastArtifact;
  const ready = !!(a && /\.aab$/i.test(a.file) && state.saFile);
  $('btnPublish').disabled = !ready;
  $('publishTarget').textContent = !a ? 'build an .aab first'
    : (!/\.aab$/i.test(a.file) ? 'Play needs an .aab — switch the target and rebuild'
      : (!state.saFile ? 'add your service-account key' : a.file.split(/[\\/]/).pop()));
}

$('btnPickSa').onclick = async () => {
  try {
    const r = await call(window.forge.publish.pickServiceAccount);
    if (!r) return;
    state.saFile = r.file;
    $('saState').textContent = r.clientEmail;
    renderPublish();
    logForge('Play service account: ' + r.clientEmail);
  } catch (e) { logForge('service account error: ' + e.message); }
};

$('btnPublish').onclick = async () => {
  if (!requireProject('publish')) return;
  if (!state.lastArtifact) { logForge('nothing to publish — build an .aab first.'); return; }
  try {
    setBusy(true);
    const res = await call(window.forge.publish.play, {
      dir: state.project.dir,
      aabPath: state.lastArtifact.file,
      track: $('playTrack').value,
      releaseNotes: $('playNotes').value.trim() || undefined,
      draft: $('playDraft').checked,
    });
    logForge('uploaded — version code ' + res.versionCode + ' on ' + res.track);
  } catch (e) {
    logForge('publish error: ' + e.message);
  } finally { setBusy(false); }
};

/* ------------------------------------------------------------ licence -- */

async function refreshLicense() {
  const s = await call(window.forge.license.status);
  state.license = s;
  const badge = $('licenseBadge');
  badge.textContent = s.licensed
    ? 'licensed'
    : (s.trialRemaining > 0 ? 'trial · ' + s.trialRemaining + ' left' : 'trial ended');
  badge.className = 'badge badge-btn ' + (s.licensed ? 'done' : s.trialRemaining > 0 ? 'running' : 'failed');
  badge.title = s.message;
  return s;
}

function openLicense() {
  const s = state.license || {};
  $('licenseError').textContent = '';
  $('licenseState').textContent = s.message || '';
  $('licenseKey').value = '';
  $('btnLicenseRemove').classList.toggle('hidden', !s.licensed);
  openModal('modalLicense');
}

$('licenseBadge').onclick = openLicense;

$('btnLicenseActivate').onclick = async () => {
  $('licenseError').textContent = '';
  try {
    const s = await call(window.forge.license.activate, $('licenseKey').value.trim());
    closeModal();
    await refreshLicense();
    logForge('licence activated — ' + s.message);
  } catch (e) {
    $('licenseError').textContent = e.message;
  }
};

$('btnLicenseRemove').onclick = async () => {
  await call(window.forge.license.clear);
  await refreshLicense();
  $('licenseState').textContent = (state.license || {}).message || '';
  $('btnLicenseRemove').classList.add('hidden');
  logForge('licence key removed from this machine');
};

/* --------------------------------------------------------------- boot -- */

(async function boot() {
  try {
    const info = await call(window.forge.app.info);
    state.platform = info.platform;
    $('appVersion').textContent = 'v' + info.version + '  ·  Electron ' + info.electron;
    const badge = $('encBadge');
    badge.textContent = info.encryptionAvailable ? 'passwords encrypted (OS keystore)' : 'no OS encryption — passwords kept in memory only';
    badge.className = 'badge ' + (info.encryptionAvailable ? 'done' : 'failed');

    logForge('Forge v' + info.version + ' ready');
    await refreshTools();
    await refreshKeystores();
    await refreshLicense();
    renderPublish();

    const settings = await call(window.forge.settings.get);
    if (settings.buildTarget) {
      const radio = document.querySelector('input[name=target][value="' + settings.buildTarget + '"]');
      if (radio) radio.checked = true;
    }
    $('chkSkipUploads').checked = settings.skipSymbolUploads !== false;
    if (settings.lastProject) {
      await refreshProject(settings.lastProject);
      logForge('reopened last project: ' + settings.lastProject);
    }
  } catch (e) {
    appendLog('[forge] startup error: ' + e.message, 'stderr');
  }
})();

for (const r of document.querySelectorAll('input[name=target]')) {
  r.onchange = () => call(window.forge.settings.set, { buildTarget: r.value }).catch(() => {});
}

$('chkSkipUploads').onchange = (e) => {
  call(window.forge.settings.set, { skipSymbolUploads: e.target.checked })
    .then(() => logForge('crash-reporter symbol uploads: ' + (e.target.checked ? 'skipped' : 'enabled')))
    .catch(() => {});
};

/* ------------------------------------------------------------------ iOS -- */

state.ios = null;
state.iosRun = null;
let iosPoll = null;

function iosDisabled(on) {
  for (const id of ['btnMakeCsr', 'btnInstallCert', 'btnPickProfile', 'btnPickAsc', 'btnIosBuild', 'btnSetBundle']) {
    const el = $(id);
    if (el) el.disabled = on;
  }
}

async function refreshIos() {
  if (!state.project || !state.project.ok) {
    $('iosRepo').textContent = '';
    return;
  }
  try {
    const s = await call(window.forge.ios.status, state.project.dir);
    state.ios = s;

    $('iosRepo').textContent = s.repo
      ? s.repo.owner + '/' + s.repo.repo
      : 'no GitHub remote';
    $('iosRepo').className = 'muted small' + (s.repo ? '' : ' warn');

    // Bundle id
    if (s.bundleId) {
      $('iosBundleId').value = s.bundleId;
      $('iosBundleState').textContent = 'set';
      $('iosBundleState').className = 'muted small ok';
    } else {
      $('iosBundleState').textContent = 'missing — the runner cannot prebuild without it';
      $('iosBundleState').className = 'muted small warn';
    }

    // Certificate
    if (s.hasP12) {
      $('iosCertState').textContent = 'ready';
      $('iosCertState').className = 'muted small ok';
    } else if (s.hasCsr) {
      $('iosCertState').textContent = 'request created — upload it to Apple, then install the .cer';
      $('iosCertState').className = 'muted small warn';
    } else {
      $('iosCertState').textContent = 'not created';
      $('iosCertState').className = 'muted small';
    }

    $('iosProfileState').textContent = s.hasProfile
      ? (s.hasAscKey ? 'profile + App Store Connect key stored' : 'stored')
      : 'not set';
    $('iosProfileState').className = 'muted small' + (s.hasProfile ? ' ok' : '');

    $('iosToken').placeholder = s.hasToken ? 'saved — paste a new one to replace it' : 'github_pat_…';

    if (!s.workflowPresent) {
      $('iosRunState').textContent = 'add the workflow in card 1 first, then commit and push it';
      $('iosRunState').className = 'muted small warn';
    } else if (!state.iosRun) {
      $('iosRunState').textContent = '';
    }
  } catch (e) {
    logForge('ios: ' + e.message);
  }
}

$('btnSetBundle').onclick = async () => {
  if (!requireProject('set the bundle identifier')) return;
  try {
    await call(window.forge.ios.setBundleId, { dir: state.project.dir, bundleId: $('iosBundleId').value.trim() });
    await refreshIos();
  } catch (e) { logForge('bundle id: ' + e.message); }
};

$('btnMakeCsr').onclick = () => {
  $('csrError').textContent = '';
  if (!$('csrName').value) $('csrName').value = '';
  openModal('modalCsr');
};

$('btnDoCsr').onclick = async () => {
  const err = $('csrError');
  err.textContent = '';
  try {
    const res = await call(window.forge.ios.createCsr, {
      name: $('csrName').value.trim(),
      email: $('csrEmail').value.trim(),
      country: $('csrCountry').value.trim() || 'US',
      password: $('csrPassword').value,
      force: $('csrForce').checked,
    });
    closeModal();
    $('csrPassword').value = '';
    logForge('now upload ' + res.csr + ' at developer.apple.com → Certificates → + → Apple Distribution');
    await refreshIos();
  } catch (e) { err.textContent = e.message; }
};

$('btnRevealCsr').onclick = async () => {
  const s = state.ios || await call(window.forge.ios.status, state.project && state.project.dir);
  if (s && s.csrPath) await call(window.forge.shell.reveal, s.csrPath).catch(() => {});
};

$('btnInstallCert').onclick = async () => {
  try {
    const cer = await call(window.forge.ios.pickCertificate);
    if (!cer) return;
    const res = await call(window.forge.ios.installCertificate, { cerPath: cer });
    const c = res.certificate || {};
    logForge('certificate installed' + (c.teamId ? ' — team ' + c.teamId : '')
      + (c.validUntil ? ', valid until ' + c.validUntil : ''));
    await refreshIos();
  } catch (e) { logForge('certificate: ' + e.message); }
};

$('btnPickProfile').onclick = async () => {
  try {
    const p = await call(window.forge.ios.pickProfile);
    if (p) { logForge('provisioning profile stored'); await refreshIos(); }
  } catch (e) { logForge('profile: ' + e.message); }
};

$('btnPickAsc').onclick = async () => {
  try {
    const p = await call(window.forge.ios.pickAscKey);
    if (p) {
      logForge('App Store Connect key stored'
        + (p.keyId ? ' — key id ' + p.keyId + ' read from the filename' : '. Rename it AuthKey_<KEYID>.p8 and re-select it if you want the key id filled in too.'));
      await refreshIos();
    }
  } catch (e) { logForge('key: ' + e.message); }
};

$('btnShowSecrets').onclick = async () => {
  const box = $('iosSecretRows');
  if (!box.classList.contains('hidden')) { box.classList.add('hidden'); box.textContent = ''; return; }
  try {
    const rows = await call(window.forge.ios.secrets);
    box.textContent = '';
    for (const row of rows) {
      const line = document.createElement('div');
      line.className = 'secret-row';
      const name = document.createElement('code');
      name.textContent = row.name;
      const note = document.createElement('span');
      note.className = 'muted small';
      note.textContent = row.note;
      const copy = document.createElement('button');
      copy.className = 'btn ghost small';
      copy.textContent = 'Copy';
      // The value itself is never rendered — a base64 .p12 is 100 KB of text,
      // and secrets have no business sitting in the DOM or in a screenshot.
      copy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(row.value);
          copy.textContent = 'Copied';
          setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
        } catch (_) { logForge('could not access the clipboard'); }
      };
      line.append(name, note, copy);
      box.appendChild(line);
    }
    box.classList.remove('hidden');
  } catch (e) { logForge('secrets: ' + e.message); }
};

$('btnOpenSecretsPage').onclick = async () => {
  const s = state.ios;
  if (!s || !s.repo) { logForge('no GitHub remote on this project.'); return; }
  await call(window.forge.shell.openPath,
    'https://github.com/' + s.repo.owner + '/' + s.repo.repo + '/settings/secrets/actions').catch(() => {});
};

$('btnSaveToken').onclick = async () => {
  const value = $('iosToken').value.trim();
  if (!value) { logForge('paste a token first.'); return; }
  try {
    const res = await call(window.forge.ios.setToken, value);
    $('iosToken').value = '';
    logForge(res.encrypted === false
      ? 'token kept in memory for this session only — the OS keystore is unavailable'
      : 'GitHub token stored, encrypted by the OS keystore');
    await refreshIos();
  } catch (e) { logForge('token: ' + e.message); }
};

$('btnIosBuild').onclick = async () => {
  if (!requireProject('build for iOS')) return;
  const s = state.ios;
  const missing = [];
  if (s && !s.bundleId) missing.push('an iOS bundle identifier');
  if (s && !s.hasP12) missing.push('a signing certificate');
  if (s && !s.hasProfile) missing.push('a provisioning profile');
  if (missing.length) {
    logForge('the runner will fail without ' + missing.join(', ') + '. Finish those steps first.');
    return;
  }
  try {
    iosDisabled(true);
    const res = await call(window.forge.ios.startBuild, {
      dir: state.project.dir,
      ref: $('iosRef').value.trim() || 'main',
      configuration: $('iosConfig').value,
      testflight: $('iosTestflight').checked,
    });
    if (res.run) {
      state.iosRun = res.run;
      const link = $('btnIosOpenRun');
      link.href = res.run.url;
      link.classList.remove('hidden');
      link.onclick = (e) => { e.preventDefault(); call(window.forge.shell.openPath, res.run.url).catch(() => {}); };
      pollIosRun();
    } else {
      logForge('the build was queued, but GitHub has not listed the run yet — check the Actions tab.');
    }
  } catch (e) {
    logForge('ios build: ' + e.message);
  } finally {
    iosDisabled(false);
  }
};

function pollIosRun() {
  clearInterval(iosPoll);
  const started = Date.now();
  const tick = async () => {
    if (!state.iosRun || !state.project) return;
    try {
      const r = await call(window.forge.ios.runStatus, { dir: state.project.dir, runId: state.iosRun.id });
      const mins = Math.round((Date.now() - started) / 60000);
      $('iosRunState').textContent = 'run #' + state.iosRun.number + ' — ' + r.status
        + (r.conclusion ? ' (' + r.conclusion + ')' : '') + ' · ' + mins + ' min';
      $('iosRunState').className = 'muted small'
        + (r.conclusion === 'success' ? ' ok' : r.conclusion && r.conclusion !== 'success' ? ' warn' : '');
      if (r.status === 'completed') {
        clearInterval(iosPoll);
        logForge('iOS build ' + r.conclusion + ' — ' + r.url);
        $('btnIosFetch').disabled = r.conclusion !== 'success';
      }
    } catch (e) {
      clearInterval(iosPoll);
      logForge('could not read the run status: ' + e.message);
    }
  };
  tick();
  // 20s: fast enough to feel live on a 15-25 minute job, slow enough to stay
  // far under GitHub's rate limit even if the window is left open all day.
  iosPoll = setInterval(tick, 20000);
}

$('btnIosFetch').onclick = async () => {
  if (!state.iosRun || !requireProject('download the .ipa')) return;
  try {
    const res = await call(window.forge.ios.fetchArtifact, { dir: state.project.dir, runId: state.iosRun.id });
    logForge('saved ' + res.path + ' (' + fmtBytes(res.bytes) + ')');
    await call(window.forge.shell.reveal, res.path).catch(() => {});
  } catch (e) { logForge('download: ' + e.message); }
};

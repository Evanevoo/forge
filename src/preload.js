'use strict';
const { contextBridge, ipcRenderer } = require('electron');

/**
 * The renderer gets exactly this surface — no Node, no fs, no child_process.
 */
const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('forge', {
  app: {
    info: () => invoke('app:info'),
  },
  settings: {
    get: () => invoke('settings:get'),
    set: (patch) => invoke('settings:set', patch),
  },
  project: {
    pick: () => invoke('project:pick'),
    inspect: (dir) => invoke('project:inspect', dir),
    prebuild: (opts) => invoke('project:prebuild', opts),
  },
  env: {
    detect: () => invoke('env:detect'),
    pick: (which) => invoke('env:pick', which),
    clearOverride: (which) => invoke('env:clearOverride', which),
  },
  keystore: {
    list: () => invoke('keystore:list'),
    select: (id) => invoke('keystore:select', id),
    pickFile: () => invoke('keystore:pickFile'),
    probe: (opts) => invoke('keystore:probe', opts),
    import: (opts) => invoke('keystore:import', opts),
    generatePath: (name) => invoke('keystore:generatePath', name),
    generate: (opts) => invoke('keystore:generate', opts),
    remove: (id) => invoke('keystore:remove', id),
    unlock: (opts) => invoke('keystore:unlock', opts),
  },
  gradle: {
    status: (dir) => invoke('gradle:status', dir),
    patch: (dir) => invoke('gradle:patch', dir),
    fixMemory: (dir) => invoke('gradle:fixMemory', dir),
  },
  build: {
    start: (opts) => invoke('build:start', opts),
    cancel: () => invoke('build:cancel'),
    clean: (opts) => invoke('build:clean', opts),
  },
  ios: {
    addWorkflow: (dir) => invoke('ios:addWorkflow', dir),
    status: (dir) => invoke('ios:status', dir),
    setBundleId: (opts) => invoke('ios:setBundleId', opts),
    createCsr: (opts) => invoke('ios:createCsr', opts),
    pickCertificate: () => invoke('ios:pickCertificate'),
    pickProfile: () => invoke('ios:pickProfile'),
    pickAscKey: () => invoke('ios:pickAscKey'),
    installCertificate: (opts) => invoke('ios:installCertificate', opts),
    secrets: () => invoke('ios:secrets'),
    setToken: (token) => invoke('ios:setToken', token),
    startBuild: (opts) => invoke('ios:startBuild', opts),
    runStatus: (opts) => invoke('ios:runStatus', opts),
    fetchArtifact: (opts) => invoke('ios:fetchArtifact', opts),
  },
  publish: {
    pickServiceAccount: () => invoke('publish:pickServiceAccount'),
    play: (opts) => invoke('publish:play', opts),
  },
  version: {
    read: (dir) => invoke('version:read', dir),
    bump: (opts) => invoke('version:bump', opts),
  },
  license: {
    status: () => invoke('license:status'),
    activate: (key) => invoke('license:activate', key),
    clear: () => invoke('license:clear'),
  },
  shell: {
    reveal: (p) => invoke('shell:reveal', p),
    openPath: (p) => invoke('shell:openPath', p),
  },
  onLog: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('forge:log', listener);
    return () => ipcRenderer.removeListener('forge:log', listener);
  },
  onStatus: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('forge:status', listener);
    return () => ipcRenderer.removeListener('forge:status', listener);
  },
});

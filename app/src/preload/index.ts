import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { NarrateApi, ExportProgress, RecorderEvent } from '../shared/types'

const listen = <T,>(channel: string) => (cb: (p: T) => void) => {
  const h = (_: unknown, p: T) => cb(p)
  ipcRenderer.on(channel, h)
  return () => { ipcRenderer.off(channel, h) }
}

const api: NarrateApi = {
  platform: process.platform as NarrateApi['platform'],
  listDevices: () => ipcRenderer.invoke('devices:list'),
  repairScreen: () => ipcRenderer.invoke('permissions:repairScreen'),
  pickArea: (displayId) => ipcRenderer.invoke('area:pick', displayId),
  areaDone: (rect) => ipcRenderer.send('area:done', rect),
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  checkPermissions: (request) => ipcRenderer.invoke('permissions:check', request),
  openSettings: (which) => ipcRenderer.invoke('settings:open', which),
  startRecording: (opts) => ipcRenderer.invoke('recording:start', opts),
  pauseRecording: () => ipcRenderer.invoke('recording:pause'),
  resumeRecording: () => ipcRenderer.invoke('recording:resume'),
  stopRecording: () => ipcRenderer.invoke('recording:stop'),
  getRecState: () => ipcRenderer.invoke('recording:state'),
  onRecorderEvent: listen<RecorderEvent>('recorder:event'),
  listProjects: () => ipcRenderer.invoke('projects:list'),
  listUnfinished: () => ipcRenderer.invoke('projects:unfinished'),
  recoverRecording: (dir) => ipcRenderer.invoke('projects:recover', dir),
  startMicMeter: (mic) => ipcRenderer.invoke('mic:meter:start', mic),
  stopMicMeter: () => ipcRenderer.invoke('mic:meter:stop'),
  onMicLevel: listen<number>('mic:level'),
  saveProject: (dir, file) => ipcRenderer.invoke('project:save', dir, file),
  analyzeProject: (dir, force) => ipcRenderer.invoke('project:analyze', dir, !!force),
  transcribeProject: (dir) => ipcRenderer.invoke('project:transcribe', dir),
  enhanceAudio: (dir) => ipcRenderer.invoke('project:enhance', dir),
  exportProject: (dir, config, cuts, suffix, format, extra) => ipcRenderer.invoke('project:export', dir, config, cuts, suffix, format, extra),
  renderThumbnails: (dir, config, cuts, timesOut, extra) => ipcRenderer.invoke('project:thumbnails', dir, config, cuts, timesOut, extra),
  onExportProgress: listen<ExportProgress>('export:progress'),
  getShareSettings: () => ipcRenderer.invoke('share:settings'),
  saveShareSettings: (s) => ipcRenderer.invoke('share:save', s),
  shareFile: (file, title) => ipcRenderer.invoke('share:file', file, title),
  onShareProgress: listen<number>('share:progress'),
  copyText: (t) => ipcRenderer.invoke('clipboard:write', t),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  onDevOpen: listen<string>('dev:open'),
  trashProject: (dir) => ipcRenderer.invoke('project:trash', dir),
  importVideo: (path) => ipcRenderer.invoke('project:import', path),
  pathForFile: (file) => webUtils.getPathForFile(file),
  addMedia: (dir, kind) => ipcRenderer.invoke('project:media', dir, kind),
  matteProject: (dir) => ipcRenderer.invoke('project:matte', dir),
  listVoices: () => ipcRenderer.invoke('voices:list'),
  speak: (dir, text, voice) => ipcRenderer.invoke('project:speak', dir, text, voice),
  grabFrame: (dir, t, poster) => ipcRenderer.invoke('project:frame', dir, t, poster),
  processClip: (dir, op, start, end, source) => ipcRenderer.invoke('project:process', dir, op, start, end, source),
  chromaKey: (dir, file, color, similarity) => ipcRenderer.invoke('project:chroma', dir, file, color, similarity),
  voiceChange: (dir, fx, clean) => ipcRenderer.invoke('project:voice', dir, fx, clean),
  timelineStrip: (dir) => ipcRenderer.invoke('project:strip', dir),
  getBrand: () => ipcRenderer.invoke('brand:get'),
  setBrand: (b) => ipcRenderer.invoke('brand:set', b),
  pickBrandLogo: () => ipcRenderer.invoke('brand:logo'),
  addMediaPath: (dir, path) => ipcRenderer.invoke('project:mediaPath', dir, path),
}
contextBridge.exposeInMainWorld('narrate', api)

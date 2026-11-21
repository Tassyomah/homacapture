/**
 * HomaPod recorder, runs inside the hidden VDO.Ninja scene window (https://vdo.ninja/?scene=0&room=R).
 * Every guest shows up there as a <video data-sid="..."> whose srcObject is their live stream; this records each one as
 * its own file, plus the host's own camera and mic straight from the devices (full quality, not through the call).
 * Chunks go to the main process as they come (nothing lost if the app dies); every track carries its wall-clock start
 * (Date.now) so all of them line up on one clock afterwards.
 */
import { ipcRenderer } from 'electron'

type Opts = { hostSid: string; micLabel: string | null; camLabel: string | null; headphones: boolean }
type Rec = { mr: MediaRecorder; key: string; sig: string; done: Promise<void> }

/** One recorder per guest. VDO.Ninja swaps a guest's tracks mid-call (quality changes, reconnects); MediaRecorder can't
 *  follow a changed track set, so a new set of live tracks closes the old file and starts the next segment. */
const bySid = new Map<string, Rec>()
const all: Rec[] = []
const perSid = new Map<string, number>()
let opts: Opts | null = null
let running = false
let scan = 0
const local: MediaStream[] = []

const pickMime = (video: boolean) => {
  const list = video
    ? ['video/mp4;codecs=avc1.640033,mp4a.40.2', 'video/webm;codecs=h264,opus', 'video/webm;codecs=vp9,opus', 'video/webm']
    : ['audio/webm;codecs=opus', 'audio/webm']
  return list.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
}

const sigOf = (s: MediaStream) => s.getTracks().filter((t) => t.readyState === 'live').map((t) => t.id).sort().join(',')

function record(stream: MediaStream, key: string, kind: 'guest' | 'host-camera' | 'host-mic', sid: string | null, bitrate: number): Rec {
  const video = stream.getVideoTracks().length > 0
  const mimeType = pickMime(video)
  const mr = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: video ? bitrate : undefined, audioBitsPerSecond: 256000 })
  const vt = stream.getVideoTracks()[0]?.getSettings()
  ipcRenderer.send('homapod:track', { key, kind, sid, mime: mr.mimeType || mimeType, t0: Date.now(), width: vt?.width ?? null, height: vt?.height ?? null,
                                      hasVideo: video, hasAudio: stream.getAudioTracks().length > 0 })
  let pending = Promise.resolve()
  mr.ondataavailable = (e) => {
    if (!e.data.size) return
    pending = pending.then(async () => ipcRenderer.send('homapod:chunk', key, new Uint8Array(await e.data.arrayBuffer())))
  }
  const done = new Promise<void>((res) => { mr.onstop = () => { void pending.then(() => { ipcRenderer.send('homapod:trackEnd', key, Date.now()); res() }) } })
  mr.onerror = () => { try { if (mr.state !== 'inactive') mr.stop() } catch { /* already stopped */ } }
  mr.start(1000)
  const r = { mr, key, sig: sigOf(stream), done }
  all.push(r)
  return r
}

function scanGuests() {
  if (!running || !opts) return
  for (const v of Array.from(document.querySelectorAll('video'))) {
    const s = v.srcObject as MediaStream | null
    const sid = v.dataset.sid
    if (!s || !sid || sid === opts.hostSid) continue
    const sig = sigOf(s)
    if (!sig) continue
    const cur = bySid.get(sid)
    if (cur && cur.sig === sig && cur.mr.state === 'recording') continue
    if (cur && cur.mr.state !== 'inactive') cur.mr.stop()
    const n = (perSid.get(sid) ?? 0) + 1; perSid.set(sid, n)
    bySid.set(sid, record(s, `guest-${sid.replace(/[^\w-]/g, '')}${n > 1 ? `-${n}` : ''}`, 'guest', sid, 16_000_000))
  }
}

async function findDevice(kind: MediaDeviceKind, label: string | null) {
  if (!label) return undefined
  const all = await navigator.mediaDevices.enumerateDevices()
  return all.find((d) => d.kind === kind && d.label === label)?.deviceId
}

async function start(o: Opts) {
  opts = o; running = true
  try {
    // Camera and mic go into ONE file when both are on: the recorder stamps both with the same capture clock, so her
    // voice can't drift from her lips (a separate mic file came out 4 s short on her first real test, 2026-11-20).
    let mic: MediaStream | null = null, cam: MediaStream | null = null
    if (o.micLabel !== null) {
      const deviceId = await findDevice('audioinput', o.micLabel)
      mic = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: 1, sampleRate: 48000,
        echoCancellation: !o.headphones, noiseSuppression: false, autoGainControl: false } })
      local.push(mic)
    }
    if (o.camLabel !== null) {
      const deviceId = await findDevice('videoinput', o.camLabel)
      // YouTube is landscape: ask for 16:9 at up to 4K (Tassy, 2026-11-20: "the recording should be landscape")
      cam = await navigator.mediaDevices.getUserMedia({ video: { deviceId: deviceId ? { exact: deviceId } : undefined,
        width: { ideal: 3840 }, height: { ideal: 2160 }, aspectRatio: { ideal: 16 / 9 }, frameRate: { ideal: 30 } } })
      local.push(cam)
      const vs = cam.getVideoTracks()[0]?.getSettings()
      if (vs?.width && vs?.height && vs.height > vs.width) ipcRenderer.send('homapod:error', 'Your camera is sending an upright (vertical) picture. For YouTube, turn the phone sideways.')
    }
    if (cam) record(new MediaStream([...cam.getVideoTracks(), ...(mic ? mic.getAudioTracks() : [])]), 'host-camera', 'host-camera', null, 40_000_000)
    else if (mic) record(mic, 'host-mic', 'host-mic', null, 0)
  } catch (e) {
    ipcRenderer.send('homapod:error', `HomaCapture could not open your ${String((e as Error).message).toLowerCase().includes('video') ? 'camera' : 'microphone'}: ${(e as Error).message}`)
  }
  scanGuests()
  scan = window.setInterval(scanGuests, 500)
}

async function stop() {
  running = false; clearInterval(scan)
  for (const r of all) if (r.mr.state !== 'inactive') r.mr.stop()
  await Promise.all(all.map((r) => r.done))
  local.forEach((s) => s.getTracks().forEach((t) => t.stop())); local.length = 0
  all.length = 0; bySid.clear(); perSid.clear()
  ipcRenderer.send('homapod:stopped')
}

ipcRenderer.on('homapod:start', (_e, o: Opts) => { void start(o) })
ipcRenderer.on('homapod:stop', () => { void stop() })

/** Tests only (NARRATE_TEST_HOMAPOD=1, with NARRATE_FAKE_MIC=1): a fake guest joins a real VDO.Ninja room, HomaPod records
 *  ~12 s through the app's own API, stops, lines up a fake phone clip, prints a JSON report and quits. Nothing is shown. */
import { app, BrowserWindow, session } from 'electron'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { guestLink } from './homapod'

/** NARRATE_TEST_HOMAPOD=shot: the same, but through the real buttons, saving pictures of the screen to NARRATE_TEST_SHOTS. */
export async function homapodShots(win: BrowserWindow) {
  const out = process.env.NARRATE_TEST_SHOTS ?? app.getPath('temp')
  const js = <T,>(code: string) => win.webContents.executeJavaScript(code) as Promise<T>
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const click = (text: string) => js(`(() => { const b = [...document.querySelectorAll("button")].find(b => (b.textContent.trim() === ${JSON.stringify(text)} || b.querySelector("b")?.textContent === ${JSON.stringify(text)})); if (b) b.click(); return !!b })()`)
  const shot = async (name: string) => { if (name !== 'hp-0-home.png' && name !== 'hp-1-start.png') await js(`document.querySelectorAll('.hp-card')[2].scrollIntoView({ block: 'end' }); true`); await wait(300); const img = await win.webContents.capturePage(); writeFileSync(join(out, name), img.toPNG()); console.log('HPTEST ' + JSON.stringify({ shot: join(out, name), size: img.getSize() })) }
  try {
    if (win.webContents.isLoading()) await new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()))
    const room = 'hptest' + Math.random().toString(36).slice(2, 8)
    await js(`localStorage.setItem('hp.room', '${room}'); localStorage.setItem('hp.guest', 'Mrs Adeyemi'); true`)
    await wait(800); await shot('hp-0-home.png')
    await click('Start a HomaPod'); await wait(1500); await shot('hp-1-start.png')
    await click('Open the call here'); await wait(4000)
    const gs = session.fromPartition('hptest-guest'); gs.setPermissionRequestHandler((_w, _p, cb) => cb(true))
    const guest = new BrowserWindow({ show: false, webPreferences: { partition: 'hptest-guest', backgroundThrottling: false } })
    guest.webContents.setAudioMuted(true)
    await guest.loadURL(guestLink(room, 'Mrs Adeyemi') + '&autostart')
    await wait(9000); await shot('hp-2-guest-joined.png')
    await click('Record'); await wait(8000); await shot('hp-3-recording.png')
    await click('Stop'); for (let i = 0; i < 60; i++) { await wait(1000); if (await js<boolean>(`!!document.querySelector('.hp-done')`)) break }
    await wait(800); await shot('hp-4-saved.png')
    guest.destroy()
  } catch (e) { console.log('HPTEST ' + JSON.stringify({ step: 'error', message: (e as Error).message })) }
  app.exit(0)
}

export async function homapodSelfTest(win: BrowserWindow, ffmpeg: string) {
  const say = (o: unknown) => console.log('HPTEST ' + JSON.stringify(o))
  const js = <T,>(code: string) => win.webContents.executeJavaScript(code) as Promise<T>
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  try {
    if (win.webContents.isLoading()) await new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()))
    const room = 'hptest' + Math.random().toString(36).slice(2, 8)
    const s = await js<{ phase: string }>(`window.narrate.homapodPrepare({ room: '${room}', guest: 'Test Guest', host: 'Tassy', mode: '${process.env.NARRATE_TEST_HOMAPOD === 'chrome' ? 'chrome' : 'here'}' })`)
    say({ step: 'prepared', phase: s.phase, room })
    const gs = session.fromPartition('hptest-guest'); gs.setPermissionRequestHandler((_w, _p, cb) => cb(true))
    const guest = new BrowserWindow({ show: false, webPreferences: { partition: 'hptest-guest', backgroundThrottling: false } })
    guest.webContents.setAudioMuted(true)
    await guest.loadURL(guestLink(room, 'Test Guest') + '&autostart')
    let st: { guests: { label: string; width: number; height: number }[] } = { guests: [] }
    for (let i = 0; i < 40 && !st.guests.length; i++) { await wait(1000); st = await js('window.narrate.homapodStatus()') }
    say({ step: 'guest-seen', guests: st.guests })
    await js(`window.narrate.homapodRecord({ micLabel: 'default', camLabel: 'default', headphones: true })`)
    await wait(12000)
    const mid = await js<{ tracks: unknown[] }>('window.narrate.homapodStatus()'); say({ step: 'recording', tracks: mid.tracks })
    const p = await js<{ dir: string } | null>('window.narrate.homapodStop()')
    if (!p) throw new Error('stop returned no project')
    say({ step: 'saved', dir: p.dir, files: readdirSync(p.dir), media: readdirSync(join(p.dir, 'media')), homapod: readdirSync(join(p.dir, 'homapod')) })
    const probe = (f: string) => execFileSync(ffmpeg.replace(/ffmpeg$/, 'ffprobe'), ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,avg_frame_rate:format=duration', '-of', 'json', f]).toString().replace(/\s+/g, '')
    for (const f of ['screen.mp4', 'mic.wav', ...readdirSync(join(p.dir, 'media')).map((m) => `media/${m}`)]) say({ step: 'probe', f, size: statSync(join(p.dir, f)).size, info: probe(join(p.dir, f)) })
    say({ step: 'homapod.json', json: JSON.parse(readFileSync(join(p.dir, 'homapod.json'), 'utf8')) })
    // a "phone" clip: the mixed sound from 4 s on, under a plain picture; it should land at about +4 s
    const phone = join(app.getPath('temp'), `hptest-phone-${Date.now()}.mp4`)
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=640x360:r=30', '-ss', '4', '-i', join(p.dir, 'mic.wav'), '-shortest', '-c:v', 'libx264', '-c:a', 'aac', phone])
    const f = await js<{ phones: unknown[] }>(`window.narrate.homapodAddPhone(${JSON.stringify(p.dir)}, [${JSON.stringify(phone)}])`)
    say({ step: 'phone', phones: f.phones })
    guest.destroy()
  } catch (e) { say({ step: 'error', message: (e as Error).message }) }
  app.exit(0)
}

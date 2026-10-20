import { useEffect, useState } from 'react'
import type { ShareSettings, ShareSettingsInput } from '../../shared/types'

/**
 * Share links (spec Phase 7): uploads the last MP4 export to the owner's Cloudflare R2 bucket and copies the link.
 * First use shows the one-time setup (the values Cloudflare's dashboard gives); the secret stays in the main process.
 */
export function SharePanel({ file, title }: { file: string | null; title: string }) {
  const [settings, setSettings] = useState<ShareSettings | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<ShareSettingsInput>({ endpoint: '', bucket: '', publicUrl: '', accessKeyId: '', secret: '' })
  const [status, setStatus] = useState<string>('')
  const [link, setLink] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  useEffect(() => { window.narrate.getShareSettings().then(setSettings) }, [])
  useEffect(() => window.narrate.onShareProgress(setProgress), [])
  useEffect(() => { setLink(null); setStatus('') }, [file])

  const edit = () => {
    if (settings?.configured) setForm({ endpoint: settings.endpoint, bucket: settings.bucket, publicUrl: settings.publicUrl, accessKeyId: settings.accessKeyId, secret: '' })
    setEditing(true); setStatus('')
  }
  const save = () => {
    setStatus('Checking the keys with Cloudflare…')
    window.narrate.saveShareSettings(form).then((s) => { setSettings(s); setEditing(false); setStatus('Sharing is set up.') })
      .catch((e: Error) => setStatus(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
  }
  const share = () => {
    if (!file) return
    setStatus(''); setLink(null); setProgress(0)
    window.narrate.shareFile(file, title).then((url) => { setLink(url); setProgress(null); window.narrate.copyText(url); setStatus('Link copied.') })
      .catch((e: Error) => { setProgress(null); setStatus(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) })
  }
  if (!settings) return null

  if (editing || !settings.configured) {
    if (!editing) return <div className="control"><div className="lbl"><span>Share link</span></div>
      <p className="note">Share links upload your video to your own Cloudflare R2 storage. Set it up once.</p>
      <button onClick={edit}>Set up sharing</button></div>
    const field = (k: keyof ShareSettingsInput, label: string, ph: string, secret = false) => (
      <label className="field" key={k}><span>{label}</span>
        <input type={secret ? 'password' : 'text'} value={form[k]} placeholder={ph} spellCheck={false}
          onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></label>)
    return <div className="control share-setup"><div className="lbl"><span>Set up sharing</span></div>
      {field('endpoint', 'S3 endpoint', 'https://<account id>.r2.cloudflarestorage.com')}
      {field('bucket', 'Bucket name', 'narrate-shares')}
      {field('publicUrl', 'Public URL', 'https://pub-….r2.dev')}
      {field('accessKeyId', 'Access Key ID', '')}
      {field('secret', 'Secret Access Key', settings.configured ? 'Leave empty to keep the saved one' : '', true)}
      <div className="row"><button className="primary" onClick={save}>Save</button>
        {settings.configured && <button onClick={() => { setEditing(false); setStatus('') }}>Cancel</button>}</div>
      {status && <p className="note">{status}</p>}</div>
  }

  return <div className="control"><div className="lbl"><span>Share link</span><button className="link" onClick={edit}>Settings</button></div>
    <button disabled={!file || progress !== null} onClick={share}>
      {progress !== null ? `Uploading ${Math.round(progress * 100)}%` : file ? 'Share last export' : 'Export an MP4 to share it'}</button>
    {progress !== null && <div className="progress"><i style={{ width: `${progress * 100}%` }} /></div>}
    {link && <p className="note share-link"><a href={link} target="_blank" rel="noreferrer">{link}</a> <button className="link" onClick={() => window.narrate.copyText(link)}>Copy</button></p>}
    {status && !link && <p className="note">{status}</p>}
    {link && <p className="note">{status} Anyone with the link can watch.</p>}</div>
}

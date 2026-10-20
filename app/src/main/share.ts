import { app, safeStorage } from 'electron'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { request } from 'node:https'
import { basename, join } from 'node:path'
import type { ShareSettings, ShareSettingsInput } from '../shared/types'

/**
 * Sharing links (spec Phase 7) on the owner's own Cloudflare R2 bucket. Each share uploads the exported MP4 and a small
 * player page to `<id>/` and returns the public page URL. Keys stay on this machine: the secret is encrypted with the
 * OS keychain (safeStorage) in userData/sharing.json and never reaches the renderer.
 */
const FILE = () => join(app.getPath('userData'), 'sharing.json')
type Stored = { endpoint: string; bucket: string; publicUrl: string; accessKeyId: string; secret: string }

function load(): Stored | null {
  if (!existsSync(FILE())) return null
  try {
    const s = JSON.parse(readFileSync(FILE(), 'utf8'))
    return { ...s, secret: safeStorage.decryptString(Buffer.from(s.secret, 'base64')) }
  } catch { return null }
}
export function getShareSettings(): ShareSettings {
  const s = load()
  return s ? { configured: true, endpoint: s.endpoint, bucket: s.bucket, publicUrl: s.publicUrl, accessKeyId: s.accessKeyId } : { configured: false }
}
export async function saveShareSettings(i: ShareSettingsInput): Promise<ShareSettings> {
  const prev = load()
  const s: Stored = {
    endpoint: (() => { try { return new URL(i.endpoint.trim()).origin } catch { return i.endpoint.trim() } })(),   // Cloudflare may show it with /bucket
    bucket: i.bucket.trim(), publicUrl: i.publicUrl.trim().replace(/\/+$/, ''),
    accessKeyId: i.accessKeyId.trim(), secret: i.secret.trim() || prev?.secret || '',
  }
  if (!/^https:\/\/[^/]+\.r2\.cloudflarestorage\.com$/.test(s.endpoint)) throw new Error('The S3 endpoint should look like https://<account id>.r2.cloudflarestorage.com')
  if (!/^https:\/\//.test(s.publicUrl)) throw new Error('The public URL should start with https:// (for example https://pub-….r2.dev)')
  if (!s.bucket || !s.accessKeyId || !s.secret) throw new Error('Bucket, Access Key ID and Secret Access Key are all needed.')
  // Prove the keys work before saving: write and read back a tiny object.
  await put(s, '.narrate-check', Buffer.from('ok'), 'text/plain')
  writeFileSync(FILE(), JSON.stringify({ ...s, secret: safeStorage.encryptString(s.secret).toString('base64') }))
  return getShareSettings()
}

// ---- AWS Signature V4 (R2 speaks the S3 API; region "auto"). Body is sent unsigned so large files stream.
const sha = (d: string | Buffer) => createHash('sha256').update(d).digest('hex')
const hmac = (k: Buffer | string, d: string) => createHmac('sha256', k).update(d).digest()
const enc = (k: string) => k.split('/').map(encodeURIComponent).join('/')

function put(s: Stored, key: string, body: Buffer | string, type: string, onProgress?: (sent: number) => void): Promise<void> {
  const host = new URL(s.endpoint).host
  const path = `/${s.bucket}/${enc(key)}`
  const size = Buffer.isBuffer(body) ? body.length : statSync(body).size
  const now = new Date(); const amz = now.toISOString().replace(/[-:]|\.\d{3}/g, ''); const day = amz.slice(0, 8)
  const headers: Record<string, string> = { host, 'content-type': type, 'content-length': String(size), 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD', 'x-amz-date': amz }
  const names = Object.keys(headers).sort()
  const canonical = ['PUT', path, '', ...names.map((n) => `${n}:${headers[n]}`), '', names.join(';'), 'UNSIGNED-PAYLOAD'].join('\n')
  const scope = `${day}/auto/s3/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', amz, scope, sha(canonical)].join('\n')
  const key4 = hmac(hmac(hmac(hmac('AWS4' + s.secret, day), 'auto'), 's3'), 'aws4_request')
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${s.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${hmac(key4, toSign).toString('hex')}`
  return new Promise((res, rej) => {
    const req = request({ method: 'PUT', host, path, headers }, (r) => {
      let out = ''; r.on('data', (c) => (out += c)); r.on('end', () => {
        if (r.statusCode && r.statusCode < 300) return res()
        const code = /<Code>([^<]+)/.exec(out)?.[1] ?? `HTTP ${r.statusCode}`
        rej(new Error(code === 'NoSuchBucket' ? `Bucket “${s.bucket}” was not found.` : code === 'InvalidAccessKeyId' || code === 'SignatureDoesNotMatch' || r.statusCode === 403
          ? 'Cloudflare refused the keys. Check the Access Key ID and Secret, and that the token can write to this bucket.' : `Upload failed (${code}).`))
      })
    })
    req.on('error', (e) => rej(new Error('Could not reach Cloudflare: ' + e.message)))
    if (Buffer.isBuffer(body)) return req.end(body)
    let sent = 0; const st = createReadStream(body)
    st.on('data', (c) => { sent += c.length; onProgress?.(sent / size) }); st.pipe(req)
  })
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
function page(title: string, video: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta property="og:title" content="${esc(title)}"><meta property="og:type" content="video.other"><meta property="og:video" content="${video}">
<style>:root{--ink:#14140F;--paper:#EFEEE8;--coral:#FB8B73}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--paper);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 16px}
main{width:100%;max-width:1100px}h1{font-size:20px;font-weight:600;margin:0 0 14px}video{width:100%;border-radius:14px;background:var(--ink);display:block}
footer{margin-top:14px;display:flex;justify-content:space-between;gap:12px;font-size:13px;opacity:.7}a{color:inherit}@media (prefers-color-scheme:dark){body{background:var(--ink);color:var(--paper)}}</style></head>
<body><main><h1>${esc(title)}</h1><video src="${video}" controls playsinline preload="metadata"></video>
<footer><span>Made with Narrate by Homalabs</span><a href="${video}" download>Download</a></footer></main></body></html>`
}

/** Uploads `file` (an exported MP4) and its player page; returns the page URL. */
export async function shareFile(file: string, title: string, onProgress: (p: number) => void): Promise<string> {
  const s = load(); if (!s) throw new Error('Sharing is not set up yet.')
  if (!/\.mp4$/i.test(file)) throw new Error('Only MP4 exports can be shared.')
  const id = randomBytes(9).toString('base64url')
  const name = basename(file).replace(/[^\w.-]+/g, '-')
  await put(s, `${id}/${name}`, file, 'video/mp4', onProgress)
  await put(s, `${id}/index.html`, Buffer.from(page(title, `${s.publicUrl}/${id}/${encodeURIComponent(name)}`)), 'text/html; charset=utf-8')
  return `${s.publicUrl}/${id}/index.html`
}

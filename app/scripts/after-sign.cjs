// macOS keeps Screen Recording and Microphone permission against an app's "designated requirement". An ad-hoc signature's
// default requirement is the exact build hash, so every rebuild looked like a new app and lost its permissions. Naming the
// bundle id as the requirement keeps the permission across rebuilds, with no certificate or keychain change.
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

exports.default = async function afterSign(ctx) {
  if (ctx.electronPlatformName !== 'darwin') return
  const app = join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`)
  const id = ctx.packager.appInfo.id
  execFileSync('codesign', ['--force', '--sign', '-', '--requirements', `=designated => identifier "${id}"`, app], { stdio: 'inherit' })
}

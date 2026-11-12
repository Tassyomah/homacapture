import type { TemplateId } from '../templates'
import { Icon } from '../../video/icons'

/**
 * A small 9:16 picture of what a short template does, drawn over a real frame of this video: the same objects the
 * template puts on screen (die-cut stickers, washi tape, polaroids, taped notes, number rings, the checklist).
 */
const INK = '#14140F', CORAL = '#FB8B73', INDIGO = '#6E71E8', YELLOW = '#FFD43B', MUSTARD = '#F5C36A', CARD = '#FBF8F2'
const HAND = '"Bradley Hand", cursive'
const abs = (s: React.CSSProperties): React.CSSProperties => ({ position: 'absolute', ...s })
const tape = (s: React.CSSProperties, c = CORAL): React.CSSProperties => abs({ width: 22, height: 7, background: c, opacity: 0.85, ...s })
const sticker = (icon: string, bg: string, s: React.CSSProperties, size = 26) => (
  <span style={abs({ width: size, height: size, borderRadius: '50%', background: bg, boxShadow: '0 0 0 2.5px #fff, 0 3px 8px rgba(0,0,0,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', ...s })}>
    <Icon name={icon} size={size * 0.56} color={INK} stroke={2.2} /></span>)

export function TemplateThumb({ id, poster }: { id: TemplateId; poster: string | null }) {
  const photo = (s: React.CSSProperties = {}): React.CSSProperties => ({ ...s, backgroundColor: '#3a3a35', backgroundImage: poster ? `url("${poster}")` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' })
  const polaroid = (s: React.CSSProperties) => <span style={abs({ width: 30, height: 36, background: '#fff', padding: 2, boxShadow: '0 3px 8px rgba(0,0,0,.3)', ...s })}><span style={photo({ display: 'block', width: 26, height: 25 })} /></span>
  let body: React.ReactNode
  if (id === 'steps') body = <>
    <div style={abs({ inset: 0, height: '40%', background: '#F4EEE3' })}>
      <span style={tape({ left: 10, top: 16, width: 30, height: 9, transform: 'rotate(-4deg)' })} /><span style={abs({ left: 13, top: 16, fontFamily: HAND, fontSize: 7, fontWeight: 700 })}>Step 2</span>
      <span style={abs({ left: 10, top: 30, fontWeight: 800, fontSize: 13, lineHeight: 1, color: INK, letterSpacing: '-0.02em' })}>Clear<br />storage</span>
      {sticker('folder', CORAL, { right: 9, top: 18 }, 30)}</div>
    <div style={photo(abs({ left: 0, right: 0, bottom: 0, top: '40%' }))} />
    <div style={abs({ left: 0, right: 0, bottom: '14%', textAlign: 'center', fontWeight: 900, fontSize: 11, color: '#fff' })}><span style={{ background: YELLOW, color: INK, padding: '0 2px' }}>SPACE</span></div></>
  else if (id === 'kinetic') body = <>
    <div style={photo(abs({ inset: 0 }))} />
    <div style={abs({ left: -4, right: -4, top: '26%', fontWeight: 900, fontSize: 24, color: INDIGO, letterSpacing: '-0.04em', whiteSpace: 'nowrap' })}>STRATEGY</div>
    <span style={abs({ right: 6, top: 8, background: '#fff', borderRadius: 6, padding: '3px 5px', display: 'flex', gap: 3, alignItems: 'center', boxShadow: '0 3px 8px rgba(0,0,0,.3)' })}>
      <i style={{ width: 9, height: 9, borderRadius: 2, background: '#A259FF' }} /><i style={{ width: 34, height: 3, borderRadius: 2, background: '#ccc' }} /></span>
    <span style={abs({ left: 6, top: '52%', background: 'rgba(20,20,15,.9)', borderRadius: 4, padding: 4, display: 'flex', flexDirection: 'column', gap: 2 })}>
      {[0, 1].map((i) => <span key={i} style={{ display: 'flex', gap: 2 }}><i style={{ width: 5, height: 5, borderRadius: 1, background: CORAL }} /><i style={{ width: 22, height: 3, background: '#EFEEE8' }} /></span>)}</span>
    <div style={abs({ left: '20%', right: '20%', bottom: '24%', background: '#fff', borderRadius: 4, padding: '2px 0', textAlign: 'center', fontSize: 7, fontWeight: 800 })}>the real reason</div></>
  else if (id === 'yellow') body = <>
    <div style={abs({ inset: 0, background: 'repeating-linear-gradient(135deg, #D9D8D2 0 4px, #E6E5DF 4px 8px)' })} />
    <div style={abs({ left: 0, right: 0, top: '6%', textAlign: 'center', fontFamily: '"Marker Felt", fantasy', fontSize: 10, color: YELLOW, textShadow: '0 1px 3px #0008', transform: 'rotate(-2deg)' })}>3 apps I use daily</div>
    <div style={photo(abs({ left: '12%', right: '12%', top: '22%', height: '56%', boxShadow: '0 0 0 2px #fff, 0 4px 10px rgba(0,0,0,.3)', transform: 'rotate(-1.5deg)' }))} />
    <span style={tape({ left: '6%', top: '20%', transform: 'rotate(-14deg)' }, MUSTARD)} />
    {sticker('palette', YELLOW, { right: 4, top: '34%' })}{polaroid({ left: 2, top: '58%', transform: 'rotate(-8deg)' })}</>
  else if (id === 'brand') body = <>
    <div style={photo(abs({ inset: 0 }))} />
    <div style={abs({ left: -6, right: -6, top: '60%', background: INDIGO, transform: 'rotate(-4deg)', padding: '2px 0', whiteSpace: 'nowrap', fontWeight: 900, fontSize: 9, color: '#EFEEE8' })}>BIG IDEA ✦ BIG IDEA ✦ BIG IDEA</div>
    {sticker('rocket', CORAL, { right: 8, top: '30%' }, 28)}
    <span style={abs({ left: 8, top: '36%', background: '#FFF4CF', padding: '4px 5px', fontFamily: HAND, fontSize: 7, fontWeight: 700, transform: 'rotate(-5deg)', boxShadow: '0 3px 8px rgba(0,0,0,.3)' })}>grow fast</span>
    <div style={abs({ left: 0, right: 0, bottom: '14%', textAlign: 'center', fontWeight: 900, fontSize: 11, color: '#fff', WebkitTextStroke: `2px ${INK}`, paintOrder: 'stroke fill' } as React.CSSProperties)}>GROW <span style={{ color: INDIGO }}>FAST</span></div></>
  else if (id === 'points') body = <>
    <div style={photo(abs({ inset: 0 }))} />
    <div style={abs({ left: '8%', right: '8%', top: '10%', background: CARD, padding: '5px 6px', display: 'flex', alignItems: 'center', gap: 5, boxShadow: '0 3px 8px rgba(0,0,0,.3)', transform: 'rotate(-2deg)' })}>
      <span style={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid ${CORAL}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: HAND, fontWeight: 700, fontSize: 10 }}>2</span>
      <span style={{ fontWeight: 800, fontSize: 8, color: INK }}>Save first</span></div>
    <span style={tape({ left: '40%', top: '8%' }, INDIGO)} />{sticker('pig', MUSTARD, { right: 4, top: '6%' }, 18)}
    <span style={abs({ right: 6, top: '50%', width: 32, height: 34, background: CARD, boxShadow: '0 3px 8px rgba(0,0,0,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 11, transform: 'rotate(4deg)' })}>
      <svg width="26" height="26" viewBox="0 0 100 100" style={{ position: 'absolute', top: 2 }}><circle cx="50" cy="50" r="40" fill="none" stroke={CORAL} strokeWidth="9" strokeDasharray="200 300" transform="rotate(-90 50 50)" /></svg>20</span></>
  else if (id === 'calm') body = <>
    <div style={photo(abs({ inset: 0, filter: 'contrast(0.9) brightness(1.06) saturate(0.85)' }))} />
    <div style={abs({ left: 0, right: 0, top: '40%', textAlign: 'center', fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 11, color: '#fff', textShadow: '0 1px 8px #0007' })}>slow mornings</div>
    {polaroid({ right: 6, top: '54%', transform: 'rotate(6deg)' })}
    <span style={abs({ left: 6, top: '56%', background: '#F3EDF9', padding: '4px 5px', fontFamily: HAND, fontSize: 7, fontWeight: 700, transform: 'rotate(-5deg)', boxShadow: '0 3px 8px rgba(0,0,0,.25)' })}>coffee first</span>
    <div style={abs({ left: '10%', right: '10%', bottom: '12%', textAlign: 'center', fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 7, color: '#fff' })}>this is how I start my day</div></>
  else body = <>
    <div style={abs({ inset: 0, background: '#F4EEE3' })} />
    <div style={abs({ left: 0, right: 0, top: '7%', textAlign: 'center', fontWeight: 800, fontSize: 10, color: INK })}>HOW I DO IT</div>
    <div style={photo(abs({ left: '10%', right: '10%', top: '21%', height: '56%', boxShadow: '0 0 0 2px #fff, 0 4px 10px rgba(0,0,0,.25)', transform: 'rotate(-1.5deg)' }))} />
    <span style={tape({ left: '4%', top: '19%', transform: 'rotate(-14deg)' }, MUSTARD)} />
    {sticker('search', CORAL, { right: 3, top: '17%' }, 22)}
    <span style={abs({ left: 3, top: '66%', background: '#FFF4CF', padding: '3px 4px', fontFamily: HAND, fontSize: 7, fontWeight: 700, transform: 'rotate(-6deg)', boxShadow: '0 3px 8px rgba(0,0,0,.25)' })}>click here</span>
    <div style={abs({ left: '12%', right: '12%', top: '83%', textAlign: 'center', fontSize: 6.5, color: '#55554F' })}>then it fills in your design for you</div></>
  return <span className="tpl-thumb" aria-hidden>{body}</span>
}

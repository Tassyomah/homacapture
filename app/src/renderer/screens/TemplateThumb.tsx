import type { TemplateId } from '../templates'

/**
 * A small 9:16 picture of what a short template does, drawn over a real frame of this video so it shows how *your*
 * footage will look. Flat shapes in the brand colours, the same layout the template renders.
 */
const INK = '#14140F', PAPER = '#EFEEE8', CORAL = '#FB8B73', INDIGO = '#6E71E8', YELLOW = '#FFD43B'
const box = (s: React.CSSProperties): React.CSSProperties => ({ position: 'absolute', ...s })
const bar = (w: string, c: string, h = 5): React.CSSProperties => ({ width: w, height: h, borderRadius: 3, background: c })

export function TemplateThumb({ id, poster }: { id: TemplateId; poster: string | null }) {
  const photo = (s: React.CSSProperties = {}): React.CSSProperties => ({ ...s, backgroundColor: '#3a3a35', backgroundImage: poster ? `url("${poster}")` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' })
  const word = (text: string, color: string, size = 9, extra: React.CSSProperties = {}) => <span style={{ fontWeight: 900, fontSize: size, color, letterSpacing: '-0.01em', lineHeight: 1, ...extra }}>{text}</span>
  let body: React.ReactNode
  if (id === 'steps') body = <>
    <div style={box({ inset: 0, height: '40%', background: PAPER, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5 })}>
      <span style={{ background: CORAL, color: INK, fontSize: 7, fontWeight: 800, borderRadius: 99, padding: '2px 6px' }}>Step 2</span>
      <span style={{ fontFamily: 'Georgia, serif', fontSize: 11, color: INK, fontWeight: 600 }}>Clear storage</span></div>
    <div style={photo(box({ left: 0, right: 0, bottom: 0, top: '40%' }))} />
    <div style={box({ left: 0, right: 0, bottom: '16%', textAlign: 'center' })}>{word('SPACE', YELLOW, 11, { textShadow: '0 1px 4px #0008' })}</div></>
  else if (id === 'kinetic') body = <>
    <div style={photo(box({ inset: 0 }))} />
    <div style={box({ left: 0, right: 0, top: '30%', textAlign: 'center' })}>{word('STOP DOING THIS', '#fff', 13, { textShadow: '0 2px 8px #0009' })}</div>
    <div style={box({ right: '6%', top: '50%', background: 'rgba(20,20,15,0.9)', borderRadius: 5, padding: 5, display: 'flex', flexDirection: 'column', gap: 3 })}>
      {[0, 1, 2].map((i) => <div key={i} style={{ display: 'flex', gap: 3, alignItems: 'center' }}><i style={{ width: 6, height: 6, borderRadius: 2, background: CORAL }} /><i style={bar(i ? '22px' : '28px', PAPER, 3)} /></div>)}</div>
    <div style={box({ left: '18%', right: '18%', bottom: '27%', background: '#fff', borderRadius: 4, padding: '3px 0', textAlign: 'center' })}>{word('the real reason', INK, 7)}</div></>
  else if (id === 'yellow') body = <>
    <div style={photo(box({ inset: 0 }))} />
    <div style={box({ left: 0, right: 0, top: '8%', textAlign: 'center', transform: 'rotate(-2deg)' })}>{word('3 apps I use daily', YELLOW, 12, { fontFamily: '"Marker Felt", fantasy', fontWeight: 400, textShadow: '0 2px 6px #0009' })}</div>
    <div style={box({ left: 0, right: 0, bottom: '16%', textAlign: 'center', fontSize: 9, fontWeight: 800, color: '#fff', textShadow: '0 1px 4px #000a' })}>this one is <span style={{ color: YELLOW }}>free</span></div></>
  else if (id === 'brand') body = <>
    <div style={photo(box({ inset: 0 }))} />
    <div style={box({ left: '-5%', right: '-5%', top: '58%', background: INDIGO, transform: 'rotate(-2deg)', textAlign: 'center', padding: '3px 0' })}>{word('BIG IDEA', PAPER, 11)}</div>
    <div style={box({ left: 0, right: 0, bottom: '16%', textAlign: 'center' })}>{word('GROW ', PAPER, 11, { WebkitTextStroke: `2px ${INK}`, paintOrder: 'stroke fill' } as React.CSSProperties)}{word('FAST', INDIGO, 12, { WebkitTextStroke: `2px ${INK}`, paintOrder: 'stroke fill' } as React.CSSProperties)}</div></>
  else if (id === 'points') body = <>
    <div style={photo(box({ inset: 0 }))} />
    <div style={box({ left: '8%', right: '8%', top: '13%', display: 'flex', alignItems: 'center', gap: 4 })}>
      <span style={{ flex: 'none', width: 16, height: 16, borderRadius: '50%', background: CORAL, color: INK, fontSize: 9, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>2</span>
      <span style={{ background: PAPER, color: INK, borderRadius: 4, padding: '3px 5px', fontSize: 8, fontWeight: 800 }}>Save first</span></div>
    <div style={box({ left: 0, right: 0, bottom: '16%', textAlign: 'center' })}>{word('MONEY', CORAL, 12, { textShadow: '0 1px 4px #0009' })}</div></>
  else if (id === 'calm') body = <>
    <div style={photo(box({ inset: 0, filter: 'contrast(0.9) brightness(1.06) saturate(0.85)' }))} />
    <div style={box({ left: 0, right: 0, top: '44%', textAlign: 'center', fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 11, color: '#fff', textShadow: '0 1px 8px #0007' })}>slow mornings</div>
    <div style={box({ left: '10%', right: '10%', bottom: '16%', textAlign: 'center', fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 7, color: '#fff' })}>this is how I start my day</div></>
  else body = <>
    <div style={box({ inset: 0, background: PAPER })} />
    <div style={box({ left: 0, right: 0, top: '9%', textAlign: 'center' })}>{word('HOW I DO IT', INK, 10)}</div>
    <div style={photo(box({ left: '5%', right: '5%', top: '22%', aspectRatio: '1', borderRadius: 6 }))} />
    <div style={box({ left: '10%', right: '10%', top: '78%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 })}><i style={bar('86%', '#9a9a93', 4)} /><i style={bar('60%', '#9a9a93', 4)} /></div></>
  return <span className="tpl-thumb" aria-hidden>{body}</span>
}

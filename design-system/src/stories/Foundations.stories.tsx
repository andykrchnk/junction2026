import { useEffect, useRef, useState } from 'react'
export default { title: 'Foundations/Design language' }
const typographyRoles = ['display', 'title', 'subtitle', 'body', 'caption', 'micro'] as const
function TypographySample({role}: {role:string}) {
 const ref=useRef<HTMLParagraphElement>(null)
 const [size,setSize]=useState('')
 useEffect(()=>{
  const read=()=>{if(ref.current)setSize(getComputedStyle(ref.current).fontSize)}
  read();const observer=new ResizeObserver(read);if(ref.current)observer.observe(ref.current)
  return ()=>observer.disconnect()
 },[role])
 const weight=['display','title','subtitle'].includes(role)?600:400
 return <p ref={ref} style={{fontFamily:'var(--font-sans)',fontSize:`var(--fs-${role})`,lineHeight:`var(--lh-${role})`,fontWeight:weight,fontVariationSettings:`'wght' ${weight}`,margin:0}}>{role.charAt(0).toUpperCase()+role.slice(1)} · {size} · {weight === 600 ? "Semibold" : "Regular"} {weight}</p>
}
export const Typography = { render: () => <div style={{display:'flex',flexDirection:'column',gap:24}}>{typographyRoles.map(role=><TypographySample key={role} role={role}/>)}<div style={{display:'flex',flexDirection:'column',gap:16,borderTop:'1px solid var(--border)',paddingTop:24}}>{([['Regular',400],['Medium',500],['Semibold',600]] as const).map(([name,weight])=><p key={name} style={{margin:0,fontSize:'var(--fs-body)',fontWeight:weight,fontVariationSettings:`'wght' ${weight}`}}>{name} · {weight}</p>)}</div></div> }
const spacingRoles = [
 ['inline','Between an icon and label, or closely related items'],
 ['control','Space within controls'],
 ['group','Between related controls or items'],
 ['stack','Between stacked content groups'],
 ['section','Between sections'],
 ['page','Generous separation between major page areas'],
] as const
function SpacingSample({role,description}: {role:string;description:string}) {
 const gapRef=useRef<HTMLDivElement>(null)
 const [pixels,setPixels]=useState('')
 useEffect(()=>{
  const read=()=>{if(gapRef.current)setPixels(`${parseFloat(getComputedStyle(gapRef.current).width)} px`)}
  read(); const observer=new ResizeObserver(read);if(gapRef.current)observer.observe(gapRef.current)
  return ()=>observer.disconnect()
 },[role])
 const block='flex items-center justify-center bg-muted border border-border text-xs text-muted-foreground'
 const gapColor='color-mix(in oklab, var(--primary) 22%, var(--background))'
 return <section className="grid gap-8 md:grid-cols-[180px_1fr_1fr] border-t py-8">
  <div><h2 className="font-semibold capitalize">{role}</h2><p className="text-xl mt-2">{pixels}</p><p className="text-xs text-muted-foreground mt-2">--space-{role}</p><p className="text-sm text-muted-foreground mt-3">{description}</p></div>
  <div><h3 className="text-sm mb-5">Horizontal gap</h3><div className="flex items-center" aria-label={`Horizontal ${role} gap: ${pixels}`}><div className={block} style={{width:72,height:56,flexShrink:0}}>Block A</div><div ref={gapRef} style={{width:`var(--space-${role})`,height:56,flexShrink:0,background:gapColor,borderLeft:'1px dashed var(--primary)',borderRight:'1px dashed var(--primary)',position:'relative'}}><span style={{position:'absolute',left:'50%',top:64,transform:'translateX(-50%)',whiteSpace:'nowrap',fontSize:12}}>{pixels}</span></div><div className={block} style={{width:72,height:56,flexShrink:0}}>Block B</div></div></div>
  <div><h3 className="text-sm mb-5">Vertical gap</h3><div style={{width:144}} aria-label={`Vertical ${role} gap: ${pixels}`}><div className={block} style={{height:40}}>Block A</div><div style={{height:`var(--space-${role})`,background:gapColor,borderTop:'1px dashed var(--primary)',borderBottom:'1px dashed var(--primary)',position:'relative'}}><span style={{position:'absolute',left:'calc(100% + 12px)',top:'50%',transform:'translateY(-50%)',whiteSpace:'nowrap',fontSize:12}}>{pixels}</span></div><div className={block} style={{height:40}}>Block B</div></div></div>
 </section>
}
export const Spacing = { render: () => <div className="max-w-6xl"><h1 className="text-2xl font-semibold mb-3">Spacing scale</h1><p className="text-sm text-muted-foreground mb-8">The green area is the exact space between two blocks. Horizontal and vertical examples use the same token. Pixel values are measured from the current design tokens; the blocks are illustrative.</p>{spacingRoles.map(([role,description])=><SpacingSample key={role} role={role} description={description}/>)}</div> }
export const Colors = { render: () => <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:16}}>{["background", "foreground", "card", "card-foreground", "popover", "popover-foreground", "primary", "primary-foreground", "secondary", "secondary-foreground", "muted", "muted-foreground", "accent", "accent-foreground", "destructive", "border", "input", "ring"].map(role => <div key={role}><div style={{height:64,background:`var(--${role})`,border:'1px solid var(--border)'}}/><code>--{role}</code></div>)}</div> }
export const Motion = { render: () => <div><h2>Official spring presets</h2><p>Fast: 80ms, no bounce · Moderate: 160ms, no bounce · Slow: 240ms, 0.12 bounce.</p><p>Explore the interactive components in Fluid / All components. Motion follows your system reduced-motion preference.</p></div> }

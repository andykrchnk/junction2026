import type { CSSProperties } from 'react'
import { Input } from '@repo/design-system/components/ui/input'
import { Badge } from '@repo/design-system/components/ui/badge'
import { Button } from '@repo/design-system/components/ui/button'
import '@repo/design-system/stories/button-prototype.css'
function PrototypePreview({edge, sheen}: {edge:number;sheen:number}) {
 const style={'--prototype-edge':edge,'--prototype-sheen':sheen} as CSSProperties
 return <div style={style} className="max-w-4xl space-y-10">
  <div><h2 className="font-semibold mb-2">Prototype · Highlighted top edge</h2><p className="text-sm text-muted-foreground">Cluely screenshot reference, adapted to our green palette and square corners.</p></div>
  <div className="grid grid-cols-[100px_1fr_1fr] gap-x-6 gap-y-5 items-center"><span/><span className="text-sm text-muted-foreground">Current</span><span className="text-sm text-muted-foreground">Prototype</span>{(['primary','secondary','tertiary','ghost','destructive'] as const).map(variant=><div key={variant} className="contents"><span className="text-sm capitalize">{variant}</span><div><Button variant={variant}>{variant==='destructive'?'Delete project':'Continue'}</Button></div><div><Button className="button-prototype" variant={variant}>{variant==='destructive'?'Delete project':'Continue'}</Button></div></div>)}</div>
  <div className="flex flex-wrap gap-4"><Button className="button-prototype">What should I say?</Button><Button className="button-prototype" loading>Loading</Button><Button className="button-prototype" disabled>Disabled</Button></div>
  <ButtonIterations/>
  <div><h3 className="font-semibold mb-3">References to explore</h3><div className="flex flex-wrap gap-5 text-sm underline"><a href="https://cluely.com" target="_blank" rel="noreferrer">Cluely</a><a href="https://linear.app" target="_blank" rel="noreferrer">Linear</a><a href="https://www.raycast.com" target="_blank" rel="noreferrer">Raycast</a><a href="https://resend.com/home" target="_blank" rel="noreferrer">Resend</a></div></div>
 </div>
}
export const Prototype = {
 args:{edge:.4,sheen:.12},
 argTypes:{edge:{name:'Top highlight',control:{type:'range',min:0,max:1,step:.05}},sheen:{name:'Surface sheen',control:{type:'range',min:0,max:.4,step:.02}}},
 render:({edge,sheen}:{edge:number;sheen:number})=><PrototypePreview edge={edge} sheen={sheen}/>,
}

const studies = [
 {name:'01 · Quiet edge',description:'Your current direction: faint sheen, a fine top edge, no outer shadow.',edge:.25,sheen:.04,shade:.04,bottom:.12,shadow:'0 0 0 transparent'},
 {name:'02 · Soft lift',description:'A restrained highlight with a soft shadow beneath the surface.',edge:.32,sheen:.07,shade:.08,bottom:.16,shadow:'0 2px 3px -1px rgb(0 0 0 / .24), 0 5px 10px -5px rgb(0 0 0 / .18)'},
 {name:'03 · Crisp bevel',description:'A brighter upper edge and a defined lower lip for a tactile feel.',edge:.52,sheen:.1,shade:.16,bottom:.32,shadow:'0 1px 0 rgb(0 0 0 / .25), 0 3px 4px -2px rgb(0 0 0 / .3)'},
 {name:'04 · Satin surface',description:'A broader wash of light over the face, with a gentle lower shadow.',edge:.38,sheen:.2,shade:.1,bottom:.18,shadow:'0 3px 6px -3px rgb(0 0 0 / .28)'},
 {name:'05 · Floating edge',description:'Minimal face lighting and deeper ambient shadow around the button.',edge:.3,sheen:.03,shade:.07,bottom:.18,shadow:'0 4px 7px -3px rgb(0 0 0 / .35), 0 10px 20px -8px rgb(0 0 0 / .3)'},
] as const
export function ButtonIterations() {
 return <div className="space-y-8"><h2 className="font-semibold">Five lighting studies</h2>{studies.map(study=>{
  const style={'--study-edge':study.edge,'--study-sheen':study.sheen,'--study-shade':study.shade,'--study-bottom':study.bottom,'--study-shadow':study.shadow} as CSSProperties
  return <section key={study.name} style={style} className="border-t pt-6 space-y-5"><div><h3 className="font-semibold">{study.name}</h3><p className="text-sm text-muted-foreground mt-2">{study.description}</p></div>
   <div className="flex flex-wrap gap-4">{(['primary','secondary','tertiary','ghost','destructive'] as const).map(variant=><Button key={variant} variant={variant} className="button-study">{variant.charAt(0).toUpperCase()+variant.slice(1)}</Button>)}<Button className="button-study" disabled>Disabled</Button></div>
   <div className="border p-5 space-y-4" style={{background:'var(--card)'}}><div className="flex items-center justify-between gap-4"><h3 className="font-semibold">Workspace settings</h3><Badge>Draft</Badge></div><Input aria-label={`${study.name} workspace name`} defaultValue="Design system"/><div className="flex flex-wrap justify-end gap-3"><Button variant="secondary" className="button-study">Cancel</Button><Button className="button-study">Save changes</Button></div></div>
  </section>
 })}</div>
}
export const Iterations = { render:()=> <div className="max-w-4xl"><ButtonIterations/></div> }

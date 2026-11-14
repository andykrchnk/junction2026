import { useState, type CSSProperties } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsItem } from '@/components/ui/tabs'
import { Gallery } from './Gallery.stories'
import './button-prototype.css'
import './balance-prototype.css'
const approaches = [
 {id:'restrained',name:'01 · Actions first',description:'Quiet Edge on primary and destructive. Secondary is softer; tertiary and surfaces stay flat.',secondary:.1,tertiary:0,surface:0},
 {id:'balanced',name:'02 · Balanced edges',description:'Quiet Edge on primary, quieter secondary, a barely visible tertiary edge. Fields and cards receive a faint matching edge.',secondary:.12,tertiary:.06,surface:.06},
 {id:'uniform',name:'03 · Shared lighting',description:'The same Quiet Edge across filled buttons, with more visible lighting on fields and panels.',secondary:.25,tertiary:.15,surface:.12},
] as const
function Balance({index=1,all=false}:{index?:number;all?:boolean}) {
 const choice=approaches[index]
 const [tab,setTab]=useState(0),[on,setOn]=useState(true)
 const style={'--balance-secondary':choice.secondary,'--balance-tertiary':choice.tertiary,'--balance-surface':choice.surface,'--study-edge':.25,'--study-sheen':.04,'--study-shade':.04,'--study-bottom':.12,'--study-shadow':'0 0 0 transparent'} as CSSProperties
 return <section style={style} className="balance-prototype space-y-6"><header><h2 className="font-semibold">{choice.name}</h2><p className="text-sm text-muted-foreground mt-2">{choice.description}</p></header>{all?<Gallery/>:<>
  <div className="flex flex-wrap gap-3">{(['primary','secondary','tertiary','ghost','destructive'] as const).map(variant=><Button key={variant} variant={variant} data-lighting={variant} className="button-study">{variant}</Button>)}</div>
  <div className="balance-panel border p-6 space-y-6" style={{background:'var(--card)'}}><div className="flex justify-between items-center"><h3 className="font-semibold">Project settings</h3><Badge>Draft</Badge></div><Tabs selectedIndex={tab} onSelect={setTab}><TabsItem index={0} label="General"/><TabsItem index={1} label="Notifications"/></Tabs>{tab===0?<div className="space-y-4"><label className="block text-sm space-y-2"><span>Project name</span><Input defaultValue="Design system"/></label><label className="block text-sm space-y-2"><span>Description</span><Textarea placeholder="Describe your workspace"/></label><label className="flex items-center gap-2 text-sm"><Checkbox/> Share with the team</label></div>:<Switch label="Email notifications" checked={on} onToggle={()=>setOn(!on)}/>}
  <div className="flex justify-end gap-3 border-t pt-5"><Button variant="tertiary" className="button-study" data-lighting="tertiary">Cancel</Button><Button variant="secondary" className="button-study" data-lighting="secondary">Save draft</Button><Button className="button-study" data-lighting="primary">Save changes</Button></div></div>
 </>}</section>
}
export default {title:'Prototypes/Component balance'}
export const Compare = {render:()=> <div className="grid grid-cols-1 2xl:grid-cols-3 gap-10">{approaches.map((choice,index)=><Balance key={choice.id} index={index}/>)}</div>}
export const ActionsFirst = {render:()=> <div className="max-w-xl"><Balance index={0}/></div>}
export const Balanced = {render:()=> <div className="max-w-xl"><Balance index={1}/></div>}
export const SharedLighting = {render:()=> <div className="max-w-xl"><Balance index={2}/></div>}

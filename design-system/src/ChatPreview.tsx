import { BrandLogo } from "./components/ui/brand-logo";
import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { Button } from './components/ui/button'
import { ChatMessage } from './components/ui/chat-message'
import { InputMessage } from './components/ui/input-message'
import { ThinkingIndicator } from './components/ui/thinking-indicator'
import { Badge } from './components/ui/badge'
import { Input } from './components/ui/input'
import { typeClass } from './lib/type-scale'
type Message={id:number;from:'user'|'assistant';text:string}
const initial:Message[]=[{id:1,from:'user',text:'Help me plan the next iteration of our design system.'},{id:2,from:'assistant',text:'Let’s focus on how the pieces work together. We have the foundations in place: Geist typography, a green accent, square corners, and a quiet highlight on the main actions.\n\nI’d start with three things:\n\n1. Refine the conversation layout and spacing.\n2. Check the composer while typing longer messages.\n3. Compare the light and dark palettes in context.\n\nWhich part would you like to explore first?'}]
export function ChatPreview(){
 const [messages,setMessages]=useState(initial),[draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[query,setQuery]=useState(''),[title,setTitle]=useState('Design system exploration')
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null),end=useRef<HTMLDivElement>(null)
 const {resolvedTheme,setTheme}=useTheme()
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current)},[])
 useEffect(()=>{end.current?.scrollIntoView({block:'nearest',behavior:'auto'})},[messages,busy])
 function stop(){if(timer.current)clearTimeout(timer.current);setBusy(false)}
 function reset(){stop();setMessages([]);setDraft('');setTitle('New conversation')}
 function send(text:string){if(!text.trim()||busy)return;setMessages(prev=>[...prev,{id:Date.now(),from:'user',text:text.trim()}]);setDraft('');setBusy(true);timer.current=setTimeout(()=>{setMessages(prev=>[...prev,{id:Date.now(),from:'assistant',text:'This is a local interaction preview, so no message is sent to an AI service.\n\nFor this iteration, we can adjust the message width, spacing, color contrast, or composer behavior. Your current green/Mist palette and shared Fluid components are applied throughout.\n\nTell me what you’d like to change here, then describe the adjustment in our main chat.'}]);setBusy(false)},1300)}
 return <div className="h-dvh grid md:grid-cols-[240px_minmax(0,1fr)]" style={{fontSize:'var(--fs-body)',lineHeight:'var(--lh-body)'}}>
 <aside className="hidden md:flex flex-col border-r p-5 gap-6" style={{background:'var(--sidebar)'}}><div className="flex items-center gap-3"><BrandLogo /></div><Button onClick={reset}>New conversation</Button><Input aria-label="Search conversations" placeholder="Search conversations…" value={query} onChange={e=>setQuery(e.target.value)}/><div className="space-y-3"><p className="text-muted-foreground text-xs">Today</p>{'Design system exploration'.toLowerCase().includes(query.toLowerCase())?<Button variant="secondary" className="w-full justify-start" onClick={()=>{stop();setMessages(initial);setTitle('Design system exploration')}}>Design system exploration</Button>:<p className="text-muted-foreground">No conversations found.</p>}</div><div className="mt-auto border-t pt-5 space-y-1"><p className="font-medium">Oskar Veres</p><p className="text-xs text-muted-foreground">Personal workspace</p></div></aside>
 <main className="min-w-0 min-h-0 flex flex-col"><header className="border-b px-5 md:px-8 py-4 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><h1 className={typeClass('subtitle')+' font-semibold'}>{title}</h1><Badge variant="dot" color="accent">Preview</Badge></div><div className="flex gap-2"><Button variant="ghost" onClick={reset}>New chat</Button><Button variant="tertiary" onClick={()=>setTheme(resolvedTheme==='dark'?'light':'dark')}>{resolvedTheme==='dark'?'Light mode':'Dark mode'}</Button></div></header>
 <div className="flex-1 overflow-y-auto min-h-0 px-5 md:px-8"><div className="max-w-[760px] mx-auto py-10 space-y-8" aria-live="polite" aria-busy={busy}>{messages.length===0?<div className="py-16 space-y-5"><p className="text-muted-foreground">A little clarity goes a long way.</p><h2 className={typeClass('display')+' font-semibold'}>What are we working on?</h2><div className="flex flex-wrap gap-3">{['Explore the design system','Plan my week','Review a product idea'].map(text=><Button key={text} variant="secondary" onClick={()=>send(text)}>{text}</Button>)}</div></div>:messages.map(m=><div key={m.id}>{m.from==='assistant'&&<p className="text-xs text-muted-foreground mb-3">Verifico assistant</p>}<ChatMessage from={m.from}><div className="whitespace-pre-wrap">{m.text}</div></ChatMessage></div>)}{busy&&<div role="status"><ThinkingIndicator/></div>}<div ref={end}/></div></div>
 <footer className="px-5 md:px-8 pb-5 pt-3"><div className="max-w-[760px] mx-auto space-y-3">{busy&&<div className="flex justify-end"><Button variant="tertiary" onClick={stop}>Stop response</Button></div>}<InputMessage value={draft} onValueChange={setDraft} onSend={send} disabled={busy} placeholder="Ask a question or share an idea…" minRows={2} maxRows={6} leftSlot={<span className="text-xs text-muted-foreground">Verifico assistant</span>}/><p className="text-center text-xs text-muted-foreground">Local preview · Simulated responses · Enter to send, Shift + Enter for a new line</p></div></footer>
 </main></div>
}

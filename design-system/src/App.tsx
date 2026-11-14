import { ThemeProvider, useTheme } from 'next-themes'
import { useEffect } from 'react'
import { FluidRoot } from './components/fluid-root'
import { ChatPreview } from './ChatPreview'
import { Dashboard } from './Dashboard'
import { Gallery } from './stories/Gallery.stories'
import './tokens.css'
function Preview() {
 const {resolvedTheme,setTheme}=useTheme()
 useEffect(()=>{const handler=(e:KeyboardEvent)=>{if(e.key.toLowerCase()==='d'&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!(e.target as HTMLElement).closest('input,textarea,[contenteditable="true"]'))setTheme(resolvedTheme==='dark'?'light':'dark')};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler)},[resolvedTheme,setTheme])
 return <FluidRoot>{window.location.pathname === '/chat' ? <ChatPreview/> : window.location.pathname === '/dashboard' ? <Dashboard/> : <main className="p-6 md:p-10"><Gallery/></main>}</FluidRoot>
}
export default function App(){return <ThemeProvider attribute="class" defaultTheme="system" enableSystem><Preview/></ThemeProvider>}

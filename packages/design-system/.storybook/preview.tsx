import type { Preview } from '@storybook/react-vite'
import { useEffect, type ReactNode } from 'react'
import '@fontsource-variable/geist'
import '@repo/design-system/styles.css'
import '@repo/design-system/tokens.css'
import { FluidRoot } from '@repo/design-system/components/fluid-root'
import { ThemeProvider, useTheme } from 'next-themes'
import { TooltipProvider } from '@repo/design-system/components/ui/tooltip'
function Workshop({children,theme}: {children:ReactNode;theme:string}) {
 const { resolvedTheme, setTheme } = useTheme()
 useEffect(()=>{setTheme(theme)},[theme,setTheme])
 useEffect(()=>{document.documentElement.style.removeProperty('--fluid-accent')},[])
 useEffect(()=>{const handler=(event:KeyboardEvent)=>{const target=event.target as HTMLElement;if(event.key.toLowerCase()==='d'&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&!target.closest('input,textarea,[contenteditable="true"]'))setTheme(resolvedTheme==='dark'?'light':'dark')};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler)},[resolvedTheme,setTheme])
 return <FluidRoot><TooltipProvider><div className="p-6 md:p-10 bg-background text-foreground min-h-screen">{children}</div></TooltipProvider></FluidRoot>
}
const preview: Preview = {
 globalTypes:{theme:{toolbar:{icon:'paintbrush',items:['system','light','dark']}}},initialGlobals:{theme:'system'},
 decorators:[(Story,context)=><ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="fluid-theme"><Workshop theme={context.globals.theme}><Story/></Workshop></ThemeProvider>],
 parameters:{layout:'fullscreen',options:{storySort:{order:['Current','Foundations','Prototypes']}}},
}
export default preview

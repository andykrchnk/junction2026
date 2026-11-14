import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Badge } from '@/components/ui/badge'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion'
import { AskUserQuestions } from '@/components/ui/ask-user-questions'
import { Banner, BannerTitle, BannerDescription } from '@/components/ui/banner'
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage } from '@/components/ui/breadcrumb'
import { Calendar } from '@/components/ui/calendar'
import { Card, CardGroup, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { CarouselDots } from '@/components/ui/carousel-dots'
import { ChatMessage } from '@/components/ui/chat-message'
import { CheckboxGroup, CheckboxItem } from '@/components/ui/checkbox-group'
import { ColorPicker } from '@/components/ui/color-picker'
import { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem } from '@/components/ui/combobox'
import { CommandMenu, CommandMenuInput, CommandMenuList } from '@/components/ui/command-menu'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Dropdown, DropdownLabel } from '@/components/ui/dropdown'
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field'
import { InputCopy } from '@/components/ui/input-copy'
import { InputGroup, InputField } from '@/components/ui/input-group'
import { InputMessage } from '@/components/ui/input-message'
import { RadioGroup, RadioItem } from '@/components/ui/radio-group'
import { Select, SelectTrigger, SelectContent, SelectItem } from '@/components/ui/select'
import { Sidebar, SidebarProvider, SidebarContent, SidebarGroup, SidebarGroupLabel } from '@/components/ui/sidebar'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Tabs, TabsItem } from '@/components/ui/tabs'
import { ThinkingIndicator } from '@/components/ui/thinking-indicator'
import { ThinkingSteps, ThinkingStepsHeader, ThinkingStepsContent, ThinkingStep } from '@/components/ui/thinking-steps'
import { Tooltip } from '@/components/ui/tooltip'

const commands = [{value:'new',label:'New project'},{value:'search',label:'Search components'}]
export function ComponentPreview({ component }: { component?: string }) {
 const [on,setOn]=useState(true), [slider,setSlider]=useState<number | [number,number]>(40), [tab,setTab]=useState(0), [dot,setDot]=useState(0), [radio,setRadio]=useState('one'), [checks,setChecks]=useState(new Set([0])), [date,setDate]=useState<Date | undefined>(new Date(2026,10,14))
 const [first,setFirst]=useState(''), [last,setLast]=useState(''), [message,setMessage]=useState('')
 const demos: [string, React.ReactNode][] = [
 ['Button',<div className="flex flex-wrap gap-3">{(['primary','secondary','tertiary','ghost','destructive'] as const).map(variant=><Button key={variant} variant={variant}>{variant}</Button>)}<Button loading>Loading</Button><Button disabled>Disabled</Button></div>],
 ['Accordion',<Accordion type="single" collapsible><AccordionItem value="one"><AccordionTrigger>Explore the interaction</AccordionTrigger><AccordionContent>Fluid uses spring motion and shared hover feedback.</AccordionContent></AccordionItem></Accordion>],
 ['AskUserQuestions',<AskUserQuestions questions={[{title:'What are you building?',options:[{title:'Workspace'},{title:'Dashboard'},{title:'Assistant'}]}]} />],
 ['Badge',<div className="flex gap-3"><Badge>Default</Badge><Badge variant="solid">Solid</Badge><Badge variant="dot">With dot</Badge></div>],
 ['Banner',<Banner><BannerTitle>Ready for review</BannerTitle><BannerDescription>Your component library is ready to explore.</BannerDescription></Banner>],
 ['Breadcrumb',<Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink href="#">Library</BreadcrumbLink></BreadcrumbItem><BreadcrumbItem><BreadcrumbPage>Components</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>],
 ['Calendar',<Calendar selected={date} onSelect={setDate}/>],
 ['Card',<CardGroup><Card><CardHeader><CardTitle>Project workspace</CardTitle><CardDescription>A neutral surface for your content.</CardDescription></CardHeader></Card></CardGroup>],
 ['CarouselDots',<CarouselDots count={5} value={dot} onValueChange={setDot}/>],
 ['ChatMessage',<><ChatMessage from="user">Show me the component library.</ChatMessage><ChatMessage from="assistant">Here are the Fluid components.</ChatMessage></>],
 ['Checkbox',<label className="flex gap-2"><Checkbox/> Enable updates</label>],
 ['CheckboxGroup',<CheckboxGroup checkedIndices={checks}>{['Design','Engineering','Product'].map((label,index)=><CheckboxItem key={label} label={label} index={index} checked={checks.has(index)} onToggle={()=>setChecks(prev=>{const next=new Set(prev);if(next.has(index))next.delete(index);else next.add(index);return next})}/>)}</CheckboxGroup>],
 ['ColorPicker',<ColorPicker defaultValue="#FF3C00"/>],
 ['Combobox',<Combobox items={['Design','Engineering','Product']}><ComboboxInput placeholder="Choose a team"/><ComboboxContent><ComboboxList>{item=><ComboboxItem value={typeof item==='string'?item:item.value}>{typeof item==='string'?item:item.label}</ComboboxItem>}</ComboboxList></ComboboxContent></Combobox>],
 ['CommandMenu',<CommandMenu items={commands}><CommandMenuInput placeholder="Search actions"/><CommandMenuList/></CommandMenu>],
 ['DatePicker',<DatePicker/>],
 ['Dialog',<Dialog><DialogTrigger asChild><Button>Open dialog</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Component preview</DialogTitle><DialogDescription>Inspect focus, keyboard dismissal, and spring motion.</DialogDescription></DialogHeader><Input aria-label="Project name" placeholder="Project name"/></DialogContent></Dialog>],
 ['Dropdown',<Dropdown><DropdownLabel>Workspace actions</DropdownLabel><Button variant="ghost">New project</Button><Button variant="ghost">Settings</Button></Dropdown>],
 ['Field',<Field><FieldLabel htmlFor="project">Project name</FieldLabel><Input id="project" placeholder="Untitled project"/><FieldDescription>A clear name for your workspace.</FieldDescription></Field>],
 ['Input',<Input aria-label="Email" placeholder="you@example.com"/>],
 ['InputCopy',<InputCopy value="https://example.com/workspace"/>],
 ['InputGroup',<InputGroup><InputField label="First name" index={0} value={first} onChange={setFirst}/><InputField label="Last name" index={1} value={last} onChange={setLast}/></InputGroup>],
 ['InputMessage',<InputMessage value={message} onValueChange={setMessage} placeholder="Ask a question…"/>],
 ['RadioGroup',<RadioGroup value={radio} onValueChange={setRadio}><RadioItem index={0} value="one" label="Personal"/><RadioItem index={1} value="two" label="Team"/></RadioGroup>],
 ['Select',<Select><SelectTrigger placeholder="Choose a role"/><SelectContent><SelectItem index={0} value="designer">Designer</SelectItem><SelectItem index={1} value="developer">Developer</SelectItem></SelectContent></Select>],
 ['Sidebar',<div className="relative h-60 overflow-hidden"><SidebarProvider><Sidebar collapsible="none"><SidebarContent><SidebarGroup><SidebarGroupLabel>Workspace</SidebarGroupLabel><Button variant="ghost">Projects</Button><Button variant="ghost">Settings</Button></SidebarGroup></SidebarContent></Sidebar></SidebarProvider></div>],
 ['Slider',<Slider label="Volume" value={slider} onChange={setSlider}/>],
 ['Switch',<Switch label="Notifications" checked={on} onToggle={()=>setOn(!on)}/>],
 ['Table',<Table><TableHeader><TableRow><TableHead>Component</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>Button</TableCell><TableCell>Ready</TableCell></TableRow><TableRow><TableCell>Input</TableCell><TableCell>Ready</TableCell></TableRow></TableBody></Table>],
 ['Tabs',<Tabs selectedIndex={tab} onSelect={setTab}><TabsItem index={0} label="Overview"/><TabsItem index={1} label="Activity"/><TabsItem index={2} label="Settings"/></Tabs>],
 ['Textarea',<Textarea aria-label="Notes" placeholder="Write a note…"/>],
 ['ThinkingIndicator',<ThinkingIndicator/>],
 ['ThinkingSteps',<ThinkingSteps defaultOpen><ThinkingStepsHeader>Working through your request</ThinkingStepsHeader><ThinkingStepsContent><ThinkingStep label="Reading components"/><ThinkingStep label="Preparing preview"/></ThinkingStepsContent></ThinkingSteps>],
 ['Tooltip',<Tooltip content="A helpful explanation"><Button variant="secondary">Hover or focus me</Button></Tooltip>],
 ]
 if (component) return <div className="max-w-xl">{demos.find(([name])=>name===component)?.[1]}</div>
 return <><div className="grid grid-cols-1 xl:grid-cols-2 gap-x-12">{demos.map(([name,demo])=><section key={name} id={name} className="min-w-0 py-8 border-t"><h2 className="font-semibold mb-5">{name}</h2><div className="max-w-lg">{demo}</div></section>)}</div></>
}

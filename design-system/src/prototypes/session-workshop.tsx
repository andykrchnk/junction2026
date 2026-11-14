import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Plus, Upload, FileText, Search, Check, X, FolderOpen, ScanLine } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { BrandLogo } from '../components/ui/brand-logo';
import { Progress } from '../components/ui/progress';
import { Select, SelectTrigger, SelectContent, SelectItem } from '../components/ui/select';
import './session-workshop.css';

export const ROOM_CLASSES = [
    'Background',
    'Outdoor',
    'Wall',
    'Kitchen',
    'Living Room',
    'Bedroom',
    'Bath',
    'Hallway',
    'Railing',
    'Storage',
    'Garage',
    'Undefined',
];
export const ICON_CLASSES = [
    'No Icon',
    'Window',
    'Door',
    'Closet',
    'Electrical Appliance',
    'Toilet',
    'Sink',
    'Sauna Bench',
    'Fire Place',
    'Bathtub',
    'Chimney',
];
const directions = [
    { name: 'Quiet list', note: 'A focused starting point. One action, a clear history.', short: 'Minimal' },
    { name: 'Plan library', note: 'Recognize your sessions by the drawings inside them.', short: 'Visual' },
    { name: 'Upload first', note: 'Start with a document. Your sessions follow below.', short: 'Guided' },
    { name: 'Workspace', note: 'An overview on the left, room to begin on the right.', short: 'Split' },
    { name: 'Session index', note: 'A compact view for a growing drawing collection.', short: 'Compact' },
];
type Session = { id: number; name: string; file: string; status: string; rooms: number; notes?: string[]; source?: File };
const examples: Session[] = [
    { id: 1, name: 'Courtyard house', file: 'Ground floor.pdf', status: 'Ready', rooms: 8 },
    { id: 2, name: 'Riverside apartment', file: 'Level 02.pdf', status: 'Needs review', rooms: 6 },
    { id: 3, name: 'Garden studio', file: 'Studio plan.png', status: 'Ready', rooms: 3 },
];
const roomSamples = [
    { name: 'Living Room', score: 96, x: 24, y: 24, w: 225, h: 158 },
    { name: 'Kitchen', score: 91, x: 257, y: 24, w: 120, h: 158 },
    { name: 'Bedroom', score: 87, x: 24, y: 190, w: 174, h: 150 },
    { name: 'Bath', score: 68, x: 206, y: 250, w: 92, h: 90 },
    { name: 'Hallway', score: 78, x: 206, y: 190, w: 171, h: 52 },
];
function Plan({ selected = -1, onSelect, small = false }: Readonly<{ selected?: number; onSelect?: (index: number) => void; small?: boolean }>) {
    return (
        <svg viewBox="0 0 402 364" className={small ? 'pw-plan-small' : 'pw-plan'} aria-label="Illustrative sample floor plan">
            <rect width="402" height="364" fill="var(--card)" />
            {roomSamples.map((r, i) => (
                <g
                    key={r.name}
                    role={onSelect ? 'button' : undefined}
                    tabIndex={onSelect ? 0 : undefined}
                    aria-label={`${r.name}, ${r.score}% confidence`}
                    onClick={() => onSelect?.(i)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSelect?.(i);
                        }
                    }}
                    style={{ cursor: onSelect ? 'pointer' : undefined }}
                >
                    <rect
                        x={r.x}
                        y={r.y}
                        width={r.w}
                        height={r.h}
                        fill={selected === i ? 'var(--primary-muted)' : 'none'}
                        stroke={selected === i ? 'var(--primary)' : 'var(--muted-foreground)'}
                        strokeWidth={selected === i ? 3 : 2}
                    />
                    {!small && (
                        <text x={r.x + r.w / 2} y={r.y + r.h / 2} textAnchor="middle" fill="var(--foreground)" fontSize="10">
                            {r.name}
                        </text>
                    )}
                </g>
            ))}
            <path d="M48 24h64m170 0h64M24 74v60m353-60v60M54 340h70" stroke="var(--primary)" strokeWidth="5" />
            <path d="M95 182v-28a28 28 0 0 1 28 28M198 278h-28a28 28 0 0 1 28-28" stroke="var(--muted-foreground)" fill="none" />
            <rect x="49" y="216" width="58" height="82" fill="none" stroke="var(--border)" strokeWidth="3" />
            <rect x="46" y="51" width="96" height="34" fill="none" stroke="var(--border)" strokeWidth="3" />
        </svg>
    );
}

export function SessionWorkshop({ initialVariant = 0 }: Readonly<{ initialVariant?: number }>) {
    const [variant, setVariant] = useState(initialVariant);
    const [sessions, setSessions] = useState<Session[]>([]);
    const [query, setQuery] = useState('');
    const [screen, setScreen] = useState<'home' | 'upload' | 'scan' | 'review' | 'session'>('home');
    const [file, setFile] = useState<File | null>(null);
    const [fileUrl, setFileUrl] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [name, setName] = useState('');
    const [progress, setProgress] = useState(0);
    const [active, setActive] = useState<Session | null>(null);
    const [selected, setSelected] = useState(-1);
    const [question, setQuestion] = useState('');
    const [answer, setAnswer] = useState(false);
    const [adding, setAdding] = useState(false);
    const [category, setCategory] = useState('Kitchen');
    const [added, setAdded] = useState<string[]>([]);
    const [inspect, setInspect] = useState(0);
    const picker = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (!file) {
            setFileUrl(null);
            return;
        }
        const url = URL.createObjectURL(file);
        setFileUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [file]);
    useEffect(() => {
        if (screen !== 'scan') return;
        const timer = window.setInterval(() => setProgress((p) => Math.min(100, p + 10)), 220);
        return () => window.clearInterval(timer);
    }, [screen]);
    useEffect(() => {
        if (screen === 'scan' && progress === 100) setScreen('review');
    }, [progress, screen]);
    function choose(next?: File) {
        if (!next) return;
        if (!/\.(pdf|png|jpe?g)$/i.test(next.name) || next.size > 20 * 1024 * 1024) {
            setError('Choose a PDF, PNG or JPG under 20 MB.');
            setScreen('upload');
            return;
        }
        setFile(next);
        setName(next.name.replace(/\.[^.]+$/, ''));
        setError('');
        setScreen('upload');
    }
    function useSample() {
        const svg =
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 402 364"><rect width="402" height="364" fill="#f5f5f2"/><g fill="none" stroke="#242424" stroke-width="3">' +
            roomSamples.map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>`).join('') +
            '</g><g fill="#242424" font-family="sans-serif" font-size="10" text-anchor="middle">' +
            roomSamples.map((r) => `<text x="${r.x + r.w / 2}" y="${r.y + r.h / 2}">${r.name}</text>`).join('') +
            '</g></svg>';
        setAdded([]);
        setAnswer(false);
        setInspect(0);
        setSelected(-1);
        setFile(new File([svg], 'Example floor plan.svg', { type: 'image/svg+xml' }));
        setName('Courtyard house');
        setError('');
        setScreen('upload');
    }
    function start() {
        setFile(null);
        setName('');
        setError('');
        setAdded([]);
        setAnswer(false);
        setInspect(0);
        setSelected(-1);
        setScreen('upload');
    }
    function enter() {
        const session = {
            id: Date.now(),
            name: name.trim() || 'Untitled session',
            file: file?.name || 'Sample blueprint',
            status: 'Ready',
            rooms: 5,
            notes: added,
            source: file || undefined,
        };
        setSessions((s) => [session, ...s]);
        setActive(session);
        setScreen('session');
    }
    function open(session: Session) {
        setActive(session);
        setFile(session.source || null);
        setInspect(0);
        setSelected(-1);
        setAdded(session.notes || []);
        setAnswer(false);
        setQuestion('');
        setScreen('session');
    }
    const shown = sessions.filter((s) => `${s.name} ${s.file}`.toLowerCase().includes(query.toLowerCase()));
    const newButton = (
        <Button leadingIcon={Plus} onClick={start}>
            New session
        </Button>
    );
    const uploadPanel = (
        <div
            className="pw-upload"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
                e.preventDefault();
                choose(e.dataTransfer.files[0]);
            }}
        >
            <Upload size={24} />
            <h2>Start with your blueprint</h2>
            <p>Drop a drawing here to begin a new session.</p>
            <Button onClick={() => picker.current?.click()} leadingIcon={Plus}>
                Choose a document
            </Button>
            <span className="pw-caption">PDF, PNG or JPG · Up to 20 MB</span>
            <Button variant="ghost" onClick={useSample}>
                Use a sample blueprint
            </Button>
        </div>
    );
    function empty() {
        return (
            <div className="pw-empty">
                <div className="pw-empty-plan">
                    <Plan small />
                </div>
                <h2>Your next project starts here.</h2>
                <p>Upload a blueprint to identify rooms and explore your space.</p>
                {newButton}
            </div>
        );
    }
    function row(s: Session, i: number) {
        return (
            <button className="pw-row" key={s.id} onClick={() => open(s)}>
                <span className="pw-index">{String(i + 1).padStart(2, '0')}</span>
                <span className="pw-row-title">
                    {s.name}
                    <small>{s.file}</small>
                </span>
                <span className="pw-status">
                    <i className={s.status === 'Ready' ? 'ready' : ''} />
                    {s.status}
                </span>
                <span className="pw-row-detail">{s.rooms} rooms</span>
                <ArrowRight size={16} />
            </button>
        );
    }
    return (
        <div className="pw-root">
            <header className="pw-workshop">
                <div>
                    <span className="pw-kicker">DESIGN EXPLORATION</span>
                    <strong>Session dashboards</strong>
                </div>
                <nav aria-label="Dashboard iterations">
                    {directions.map((d, i) => (
                        <Button
                            key={d.name}
                            variant={variant === i ? 'secondary' : 'ghost'}
                            aria-pressed={variant === i}
                            onClick={() => {
                                setVariant(i);
                                setScreen('home');
                            }}
                        >
                            {i + 1}
                            <span className="pw-tab-label" style={{ marginLeft: 8 }}>
                                {d.short}
                            </span>
                        </Button>
                    ))}
                </nav>
                <Button
                    variant="tertiary"
                    onClick={() => {
                        setSessions(sessions.length ? [] : examples);
                        setScreen('home');
                    }}
                >
                    {sessions.length ? 'Show empty state' : 'Load sample sessions'}
                </Button>
            </header>
            <div className="pw-notice">
                <span>
                    {String(variant + 1).padStart(2, '0')} / {directions[variant].name}
                </span>
                <span>{directions[variant].note}</span>
                <span>Prototype · Simulated analysis · Files stay in this browser</span>
            </div>
            <input
                ref={picker}
                className="sr-only"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                aria-label="Choose blueprint"
                onChange={(e) => {
                    choose(e.target.files?.[0]);
                    e.target.value = '';
                }}
            />
            <div className={`pw-shell pw-v${variant}`}>
                {(variant === 0 || variant === 3 || variant === 4) && (
                    <aside className="pw-sidebar">
                        <BrandLogo />
                        <div className="pw-account">
                            <span>Personal workspace</span>
                            <small>@oscaritoburito</small>
                        </div>
                        <Button variant="secondary" leadingIcon={FolderOpen} onClick={() => setScreen('home')}>
                            Your sessions
                        </Button>
                        <div className="pw-sidebar-bottom">
                            <span className="pw-avatar">O</span>
                            <div>
                                Oscar<small>Design preview</small>
                            </div>
                        </div>
                    </aside>
                )}
                <div className="pw-content">
                    {(variant === 1 || variant === 2) && (
                        <div className="pw-topbar">
                            <BrandLogo />
                            <span>Personal workspace</span>
                            <span className="pw-avatar">O</span>
                        </div>
                    )}
                    {screen === 'home' ? (
                        <main className="pw-main">
                            <div className="pw-title">
                                <div>
                                    <p className="pw-eyebrow">WORKSPACE</p>
                                    <h1>
                                        Your sessions<span className="pw-count">{sessions.length}</span>
                                    </h1>
                                    <p>Every blueprint. Every answer. One place.</p>
                                </div>
                                {variant !== 2 && newButton}
                            </div>
                            {variant === 2 && (
                                <div className="pw-guided">
                                    <div>
                                        <span className="pw-kicker">FROM PLAN TO UNDERSTANDING</span>
                                        <h2>
                                            Give your drawings
                                            <br />a second pair of eyes.
                                        </h2>
                                        <ol>
                                            <li>
                                                <span>01</span>Upload your blueprint
                                            </li>
                                            <li>
                                                <span>02</span>Review what we find
                                            </li>
                                            <li>
                                                <span>03</span>Ask with context
                                            </li>
                                        </ol>
                                    </div>
                                    {uploadPanel}
                                </div>
                            )}
                            <div className="pw-tools">
                                <span>{variant === 2 ? 'Recent sessions' : variant === 4 ? 'All sessions' : 'Your library'}</span>
                                <div>
                                    <Search size={16} />
                                    <Input
                                        aria-label="Search sessions"
                                        value={query}
                                        onChange={(e) => setQuery(e.target.value)}
                                        placeholder="Find a session…"
                                    />
                                </div>
                            </div>
                            {variant === 3 ? (
                                <div className="pw-split">
                                    <div>
                                        {shown.length ? (
                                            shown.map(row)
                                        ) : (
                                            <div className="pw-list-empty">
                                                <FolderOpen size={22} />
                                                <h2>No sessions yet</h2>
                                                <p>New sessions will appear here.</p>
                                            </div>
                                        )}
                                    </div>
                                    <section className="pw-start">
                                        <span className="pw-kicker">A CLEARER PICTURE</span>
                                        <Plan small />
                                        <h2>What are you working on?</h2>
                                        <p>
                                            Begin a session with a floor plan.
                                            <br />
                                            We’ll help you read between the lines.
                                        </p>
                                        {newButton}
                                    </section>
                                </div>
                            ) : variant === 1 ? (
                                <div className="pw-gallery">
                                    <button className="pw-new-card" onClick={start}>
                                        <Plus size={26} />
                                        <h2>New session</h2>
                                        <p>Add a blueprint to your library</p>
                                    </button>
                                    {shown.map((s) => (
                                        <button className="pw-session-card" key={s.id} onClick={() => open(s)}>
                                            <div>
                                                <Plan small />
                                            </div>
                                            <section>
                                                <h2>{s.name}</h2>
                                                <p>{s.file}</p>
                                                <footer>
                                                    <span>{s.status}</span>
                                                    <ArrowRight size={16} />
                                                </footer>
                                            </section>
                                        </button>
                                    ))}
                                </div>
                            ) : variant === 4 ? (
                                <div className="pw-table">
                                    <div className="pw-table-head">
                                        <span>SESSION</span>
                                        <span>STATUS</span>
                                        <span>ROOMS</span>
                                    </div>
                                    {shown.length ? (
                                        shown.map(row)
                                    ) : (
                                        <div className="pw-list-empty">
                                            <h2>A clean slate.</h2>
                                            <p>Your sessions will be listed here. Create your first to get started.</p>
                                            {newButton}
                                        </div>
                                    )}
                                </div>
                            ) : shown.length ? (
                                <div>{shown.map(row)}</div>
                            ) : query ? (
                                <div className="pw-list-empty">No sessions match “{query}”.</div>
                            ) : variant === 2 ? (
                                <div className="pw-list-empty">
                                    <p>No sessions yet. Upload your first drawing above.</p>
                                </div>
                            ) : (
                                empty()
                            )}
                            {query && !shown.length && (variant === 1 || variant === 3 || variant === 4) && (
                                <p className="pw-muted">No sessions match “{query}”.</p>
                            )}
                            <footer className="pw-foot">
                                <span>Pirto / Drawing intelligence</span>
                                <span>Your work, with more context.</span>
                            </footer>
                        </main>
                    ) : (
                        <main className="pw-flow">
                            <Button variant="ghost" leadingIcon={ArrowLeft} onClick={() => setScreen('home')}>
                                Your sessions
                            </Button>
                            {screen === 'upload' && (
                                <section className="pw-upload-step">
                                    <p className="pw-eyebrow">NEW SESSION / 01</p>
                                    <h1>Bring your blueprint.</h1>
                                    <p>One drawing is all you need to start.</p>
                                    {file ? (
                                        <div className="pw-file">
                                            <FileText />
                                            <div>
                                                <strong>{file.name}</strong>
                                                <small>{(file.size / 1024 / 1024).toFixed(1)} MB · Ready to preview</small>
                                            </div>
                                            <Button variant="ghost" aria-label="Remove document" onClick={() => setFile(null)}>
                                                <X size={16} />
                                            </Button>
                                        </div>
                                    ) : (
                                        uploadPanel
                                    )}
                                    {error && (
                                        <p role="alert" className="text-destructive">
                                            {error}
                                        </p>
                                    )}
                                    {file && (
                                        <>
                                            <label className="pw-label">
                                                Session name
                                                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this session" />
                                            </label>
                                            <div className="pw-actions">
                                                <Button variant="tertiary" onClick={() => picker.current?.click()}>
                                                    Replace file
                                                </Button>
                                                <Button
                                                    trailingIcon={ArrowRight}
                                                    onClick={() => {
                                                        setProgress(0);
                                                        setScreen('scan');
                                                    }}
                                                >
                                                    Preview analysis
                                                </Button>
                                            </div>
                                            <p className="pw-caption">This prototype uses example detections, not an analysis of your file.</p>
                                        </>
                                    )}
                                </section>
                            )}
                            {screen === 'scan' && (
                                <section className="pw-upload-step">
                                    <ScanLine size={32} className="text-primary" />
                                    <p className="pw-eyebrow">SIMULATED ANALYSIS / 02</p>
                                    <h1>Reading the drawing.</h1>
                                    <p>{file?.name}</p>
                                    <Progress value={progress} />
                                    <ol className="pw-scan-steps">
                                        {[
                                            'Preparing the document',
                                            'Locating rooms and walls',
                                            'Identifying doors, windows and fixtures',
                                            'Preparing your review',
                                        ].map((text, i) => (
                                            <li key={text}>
                                                {progress > i * 25 ? <Check size={16} /> : <span className="pw-step-dot" />}
                                                {text}
                                            </li>
                                        ))}
                                    </ol>
                                    <Button variant="tertiary" onClick={() => setScreen('upload')}>
                                        Cancel
                                    </Button>
                                </section>
                            )}
                            {(screen === 'review' || screen === 'session') && (
                                <>
                                    <div className="pw-title">
                                        <div>
                                            <p className="pw-eyebrow">{screen === 'review' ? 'REVIEW / 03' : 'SESSION'}</p>
                                            <h1>{screen === 'review' ? 'A first look at your plan.' : active?.name}</h1>
                                            <p>Example detections · Confidence is a guide, not a guarantee.</p>
                                        </div>
                                        {screen === 'review' && (
                                            <Button trailingIcon={ArrowRight} onClick={enter}>
                                                Enter session
                                            </Button>
                                        )}
                                    </div>
                                    <div className="pw-review">
                                        <section className="pw-drawing">
                                            <div className="pw-drawing-bar">
                                                <span>{inspect === 0 ? 'Example floor plan' : file?.name}</span>
                                                {fileUrl && (
                                                    <Button variant="tertiary" onClick={() => setInspect(inspect === 0 ? 1 : 0)}>
                                                        {inspect === 0 ? 'View uploaded file' : 'View sample detections'}
                                                    </Button>
                                                )}
                                            </div>
                                            {inspect === 1 && fileUrl ? (
                                                file?.type === 'application/pdf' ? (
                                                    <iframe title="Uploaded blueprint" src={fileUrl} className="pw-document" />
                                                ) : (
                                                    <img alt="Your uploaded blueprint" src={fileUrl} className="pw-document" />
                                                )
                                            ) : (
                                                <Plan selected={selected} onSelect={setSelected} />
                                            )}
                                            <p className="pw-caption">
                                                {inspect === 0
                                                    ? 'Illustrative floor plan · Select a room to inspect evidence.'
                                                    : 'Local file preview · Detections are shown on the sample plan only.'}
                                            </p>
                                        </section>
                                        <aside className="pw-findings">
                                            <h2>{screen === 'review' ? 'What we found' : 'Plan context'}</h2>
                                            <p>5 rooms · 4 windows · 2 doors</p>
                                            {roomSamples.map((r, i) => (
                                                <button
                                                    key={r.name}
                                                    className={`pw-finding ${selected === i ? 'is-selected' : ''}`}
                                                    onClick={() => {
                                                        setSelected(i);
                                                        setInspect(0);
                                                    }}
                                                >
                                                    <span>{r.name}</span>
                                                    <span>
                                                        {r.score}%{r.score < 75 ? ' · Review' : ''}
                                                    </span>
                                                </button>
                                            ))}
                                            {added.map((r, i) => (
                                                <div key={i} className="pw-finding">
                                                    <span>{r}</span>
                                                    <span>Added by you</span>
                                                </div>
                                            ))}
                                            <Button variant="tertiary" leadingIcon={Plus} onClick={() => setAdding(!adding)}>
                                                Add missing item
                                            </Button>
                                            {adding && (
                                                <form
                                                    className="pw-add"
                                                    onSubmit={(e) => {
                                                        e.preventDefault();
                                                        setAdded((a) => [...a, category]);
                                                        if (active && screen === 'session')
                                                            setSessions((list) =>
                                                                list.map((s) => (s.id === active.id ? { ...s, notes: [...added, category] } : s)),
                                                            );
                                                        setAdding(false);
                                                    }}
                                                >
                                                    <Select
                                                        value={category}
                                                        onValueChange={(v) => {
                                                            if (v) setCategory(v);
                                                        }}
                                                    >
                                                        <SelectTrigger placeholder="Choose a class" />
                                                        <SelectContent>
                                                            {[...ROOM_CLASSES, ...ICON_CLASSES].map((c, i) => (
                                                                <SelectItem key={c} index={i} value={c}>
                                                                    {c}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                    <p className="pw-caption">Adds a review note. Drawing boundaries comes in the next iteration.</p>
                                                    <Button type="submit">Add to review</Button>
                                                </form>
                                            )}
                                            {screen === 'session' && (
                                                <div className="pw-chat">
                                                    <h2>Ask your blueprint</h2>
                                                    <p>Try: Which room has the most windows?</p>
                                                    <form
                                                        onSubmit={(e) => {
                                                            e.preventDefault();
                                                            if (question.trim()) {
                                                                setAnswer(true);
                                                                setSelected(0);
                                                                setInspect(0);
                                                            }
                                                        }}
                                                    >
                                                        <Input
                                                            aria-label="Question about blueprint"
                                                            value={question}
                                                            onChange={(e) => setQuestion(e.target.value)}
                                                            placeholder="Ask about this plan…"
                                                        />
                                                        <Button type="submit" disabled={!question.trim()} trailingIcon={ArrowRight}>
                                                            Ask
                                                        </Button>
                                                    </form>
                                                    {answer && (
                                                        <div className="pw-answer">
                                                            <span className="pw-kicker">EXAMPLE RESPONSE</span>
                                                            <p>
                                                                In this sample plan, the living room has two windows. I’ve highlighted the room used as
                                                                evidence.
                                                            </p>
                                                            <Button
                                                                variant="ghost"
                                                                onClick={() => {
                                                                    setSelected(0);
                                                                    setInspect(0);
                                                                }}
                                                            >
                                                                View evidence · Living Room
                                                            </Button>
                                                            <small>Scripted response for UX review, not an AI answer to your file.</small>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </aside>
                                    </div>
                                </>
                            )}
                        </main>
                    )}
                </div>
            </div>
        </div>
    );
}

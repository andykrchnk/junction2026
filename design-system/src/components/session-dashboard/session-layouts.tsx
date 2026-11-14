import { useState } from 'react';
import { Plus, ChevronDown, ArrowUpRight, FileText, LogOut } from '@/lib/icons-remix';
import { Button } from '../ui/button';
import { BrandLogo } from '../ui/brand-logo';
import { DropdownMenu, DropdownTrigger, DropdownContent } from '../ui/dropdown';
import { MenuItem } from '../ui/menu-item';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../ui/table';
import { ViewSwitch } from './view-switch';
import './session-layouts.css';

export const OFFICIAL_TABLE_VARIANT = 0; // Quiet rules

type PreviewSession = { id: number; name: string; file: string; status: string; rooms?: number };
const sortLabels = ['Recently added', 'Name A–Z', 'Name Z–A', 'Room count'];
export const layoutDirections = [
    { name: 'Balanced', short: 'Balanced', note: 'Three generous cards with an understated frame.' },
    { name: 'Five across', short: 'Compact', note: 'Five plans in a row, close to your sketch.' },
    { name: 'Open gallery', short: 'Open', note: 'Unframed previews, with the details below.' },
    { name: 'Drawing sheets', short: 'Sheets', note: 'Portrait drawing previews with an architectural caption.' },
    { name: 'Wide library', short: 'Wide', note: 'Two wide previews with room for session context.' },
];
function Thumbnail({ index }: Readonly<{ index: number }>) {
    const shift = index % 3;
    return (
        <svg viewBox="0 0 340 220" aria-label="Sample blueprint thumbnail" role="img">
            <g fill="none" stroke="currentColor" strokeWidth="2">
                <path
                    d={shift === 1 ? 'M56 30h230v158H56zM56 120h230M168 30v90M220 120v68' : 'M48 28h244v164H48zM48 126h154M202 28v164M202 95h90M130 126v66'}
                />
                <path d="M88 28h45m159 20v36M48 58v36" stroke="var(--primary)" strokeWidth="4" />
                <path d="M202 82h-24a24 24 0 0 1 24-24M130 160h-20a20 20 0 0 1 20-20" strokeWidth="1" />
                <rect x="68" y="48" width="46" height="22" opacity=".35" />
                <rect x="224" y="120" width="34" height="50" opacity=".35" />
            </g>
            <g stroke="currentColor" opacity=".2" strokeWidth=".5">
                <path d="M48 12h244M48 8v9M292 8v9M310 28v164M306 28h8M306 192h8" />
            </g>
        </svg>
    );
}
export function SessionLayouts({
    variant,
    sessions,
    onNew,
    onOpen,
    accountName = 'Oscar',
    onSignOut,
    pending = false,
    loading = false,
    sample = true,
    error,
    tableVariant = OFFICIAL_TABLE_VARIANT,
    initialTable = false,
}: Readonly<{
    variant: number;
    sessions: PreviewSession[];
    onNew: () => void;
    onOpen: (session: PreviewSession) => void;
    accountName?: string;
    onSignOut?: () => void;
    pending?: boolean;
    loading?: boolean;
    sample?: boolean;
    error?: string;
    tableVariant?: number;
    initialTable?: boolean;
}>) {
    const [list, setList] = useState(initialTable);
    const [sort, setSort] = useState(0);
    const [accountOpen, setAccountOpen] = useState(false);
    const ordered = [...sessions].sort((a, b) =>
        sort === 1 ? a.name.localeCompare(b.name) : sort === 2 ? b.name.localeCompare(a.name) : sort === 3 ? (b.rooms ?? 0) - (a.rooms ?? 0) : b.id - a.id,
    );
    return (
        <div className={`sl-root sl-${variant}`}>
            <header className="sl-header">
                <BrandLogo className="sl-logo" />
                <DropdownMenu open={accountOpen} onOpenChange={setAccountOpen}>
                    <DropdownTrigger
                        render={
                            <Button variant="ghost" className="sl-account">
                                <span className="sl-avatar">{accountName.slice(0, 1).toUpperCase()}</span>
                                <span>{accountName}</span>
                            </Button>
                        }
                    />
                    <DropdownContent align="end">
                        {onSignOut && <MenuItem index={0} label="Log out" trailingIcon={LogOut} onSelect={onSignOut} />}
                    </DropdownContent>
                </DropdownMenu>
            </header>
            <main className="sl-main">
                <div className="sl-heading">
                    <h1>Your sessions</h1>
                    <Button leadingIcon={Plus} onClick={onNew} loading={pending}>
                        New session
                    </Button>
                </div>
                <div className="sl-divider" />
                {error && (
                    <p role="alert" className="py-4 text-destructive">
                        {error}
                    </p>
                )}
                <div className="sl-toolbar">
                    <DropdownMenu>
                        <DropdownTrigger
                            render={
                                <Button variant="ghost" trailingIcon={ChevronDown}>
                                    {sortLabels[sort]}
                                </Button>
                            }
                        />
                        <DropdownContent checkedIndex={sort} align="start">
                            {sortLabels.map((label, index) => (
                                <MenuItem key={label} index={index} label={label} checked={sort === index} onSelect={() => setSort(index)} />
                            ))}
                        </DropdownContent>
                    </DropdownMenu>
                    <ViewSwitch label="Table view" checked={list} onToggle={() => setList((v) => !v)} />
                </div>
                {loading ? (
                    <p role="status" className="text-muted-foreground">
                        Loading sessions…
                    </p>
                ) : !ordered.length ? (
                    <div className="sl-empty">
                        <FileText size={24} />
                        <h2>No sessions yet</h2>
                        <p>Upload a blueprint to start your first session.</p>
                        <Button variant="secondary" onClick={onNew}>
                            Create a session
                        </Button>
                    </div>
                ) : list ? (
                    <div className={`sl-table sl-table-${tableVariant}`}>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Session</TableHead>
                                    <TableHead>Document</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Rooms</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {ordered.map((s, index) => (
                                    <TableRow key={s.id} index={index} className="sl-session-row" onClick={() => onOpen(s)}>
                                        <TableCell>
                                            <button
                                                type="button"
                                                className="sl-session-open"
                                                aria-label={`Open ${s.name}`}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    onOpen(s);
                                                }}
                                            >
                                                {s.name}
                                            </button>
                                        </TableCell>
                                        <TableCell>{s.file}</TableCell>
                                        <TableCell>
                                            <span className={`sl-table-status ${s.status === 'Ready' ? 'is-ready' : 'needs-review'}`}>{s.status}</span>
                                        </TableCell>
                                        <TableCell>{s.rooms ?? '—'}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                ) : (
                    <div className="sl-grid">
                        {ordered.map((s, i) => (
                            <button className="sl-card" key={s.id} onClick={() => onOpen(s)}>
                                <div className="sl-image">
                                    {sample ? <Thumbnail index={i} /> : <FileText size={48} aria-label="Drawing document" />}
                                    {variant === 3 && <span className="sl-sheet-number">A / {String(i + 1).padStart(2, '0')}</span>}
                                </div>
                                <div className="sl-card-copy">
                                    <div className="sl-card-title">
                                        <h2>{s.name}</h2>
                                        <ArrowUpRight size={15} />
                                    </div>
                                    <p>{s.file}</p>
                                    <div className="sl-card-meta">
                                        <span>
                                            <i className={s.status === 'Ready' ? '' : 'sl-review-dot'} />
                                            {s.status}
                                        </span>
                                        {s.rooms !== undefined && <span>{s.rooms} rooms</span>}
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}

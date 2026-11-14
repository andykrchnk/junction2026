import { useState, type ReactNode } from 'react';
import { Plus, ChevronDown, FileText, Upload, ScanLine, GridIcon, Check, ArrowUpRight } from '@repo/design-system/lib/icons-remix';
import { Button } from '@repo/design-system/components/ui/button';
import { AppHeader } from '@/components/app-header';
import { DropdownMenu, DropdownTrigger, DropdownContent } from '@repo/design-system/components/ui/dropdown';
import { MenuItem } from '@repo/design-system/components/ui/menu-item';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@repo/design-system/components/ui/table';
import { ViewSwitch } from '@repo/design-system/components/ui/view-switch';
import '@/components/session-dashboard/session-layouts.css';

export const OFFICIAL_TABLE_VARIANT = 0; // Quiet rules

type PreviewSession = {
    id: number;
    name: string;
    file: string;
    status: string;
    rooms?: number;
    createdAt?: string;
    documentCount?: number;
    uploadProgress?: number;
    cover?: ReactNode;
};
const sortLabels = ['Recently added', 'Name A–Z', 'Name Z–A', 'Document count'];
export const layoutDirections = [
    { name: 'Balanced', short: 'Balanced', note: 'Three generous cards with an understated frame.' },
    { name: 'Five across', short: 'Compact', note: 'Five plans in a row, close to your sketch.' },
    { name: 'Open gallery', short: 'Open', note: 'Unframed previews, with the details below.' },
    { name: 'Drawing sheets', short: 'Sheets', note: 'Portrait drawing previews with an architectural caption.' },
    { name: 'Wide library', short: 'Wide', note: 'Two wide previews with room for session context.' },
];
function SessionDate({ value }: Readonly<{ value?: string }>) {
    return value ? (
        <time dateTime={value}>
            {new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value))}
        </time>
    ) : (
        <>—</>
    );
}
export function SessionStatus({ status, rooms, uploadProgress }: Readonly<{ status: string; rooms?: number; uploadProgress?: number }>) {
    const uploading = status === 'Uploading';
    const analyzing = status === 'Analyzing';
    const identified = !uploading && !analyzing && rooms !== undefined;
    const Icon = uploading ? Upload : analyzing ? ScanLine : identified ? GridIcon : Check;
    const label = uploading
        ? `Uploading${uploadProgress === undefined ? '' : ` · ${Math.round(Math.max(0, Math.min(100, uploadProgress)))}%`}`
        : analyzing
          ? 'Analyzing'
          : identified
            ? `${rooms} ${rooms === 1 ? 'room' : 'rooms'} identified`
            : status;
    return (
        <div className="sl-status-cell">
            <span className="sl-status-icon-label">
                <Icon size={16} className={uploading ? 'sl-icon-uploading' : analyzing ? 'sl-icon-analyzing' : undefined} />
                <span>{label}</span>
            </span>
        </div>
    );
}
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
    const ordered = [...sessions].sort((a, b) =>
        sort === 1
            ? a.name.localeCompare(b.name)
            : sort === 2
              ? b.name.localeCompare(a.name)
              : sort === 3
                ? (b.documentCount ?? 0) - (a.documentCount ?? 0)
                : b.id - a.id,
    );
    return (
        <div className={`sl-root sl-${variant}`}>
            <AppHeader accountName={accountName} onSignOut={onSignOut} />
            <main className="sl-main">
                <div className="sl-heading">
                    <h1>Your sessions</h1>
                    <Button className="sl-new-session" leadingIcon={Plus} onClick={onNew} loading={pending}>
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
                ) : !ordered.length && error ? null : !ordered.length ? (
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
                                    <TableHead>Name</TableHead>
                                    <TableHead>Date created</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Documents uploaded</TableHead>
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
                                        <TableCell>
                                            <SessionDate value={s.createdAt} />
                                        </TableCell>
                                        <TableCell>
                                            <SessionStatus status={s.status} rooms={s.rooms} uploadProgress={s.uploadProgress} />
                                        </TableCell>
                                        <TableCell className="sl-count-cell">
                                            {s.documentCount ?? '—'}
                                            <ArrowUpRight size={16} className="sl-row-arrow" />
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                ) : (
                    <div className="sl-grid">
                        {ordered.map((s, i) => (
                            <button className="sl-card" key={s.id} onClick={() => onOpen(s)}>
                                <div className={`sl-image${!sample && s.cover ? ' sl-image-cover' : ''}`}>
                                    {sample ? <Thumbnail index={i} /> : (s.cover ?? <FileText size={48} aria-label="Drawing document" />)}
                                    {variant === 3 && <span className="sl-sheet-number">A / {String(i + 1).padStart(2, '0')}</span>}
                                </div>
                                <div className="sl-card-copy">
                                    <div className="sl-card-title">
                                        <h2>{s.name}</h2>
                                    </div>
                                    <p>
                                        Created <SessionDate value={s.createdAt} />
                                    </p>
                                    <div className="sl-card-meta">
                                        <SessionStatus status={s.status} rooms={s.rooms} uploadProgress={s.uploadProgress} />
                                        <span className="sl-document-count">
                                            {s.documentCount ?? '—'} {s.documentCount === 1 ? 'document' : 'documents'}
                                        </span>
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

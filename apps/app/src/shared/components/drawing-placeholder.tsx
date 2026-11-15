const skyline = [
    '                    |',
    '                   | |',
    '                   | |      ______',
    '          ____     | |     |  []  |',
    '    /\\   | [] |    | |     |  []  |',
    '   /  \\  | [] |  __| |__   |  []  |',
    '  /____\\ | [] | | [] [] |  |  []  |',
    '  | [] | | [] | | [] [] |  |  []  |',
    '  | __ | | __ | | __ __ |  |  __  |',
    '__||__|_|_||__|_|_||_||_|__|__||__|__',
].join('\n');

export function DrawingPlaceholder() {
    return (
        <div
            role="img"
            aria-label="Architectural skyline — no drawing preview"
            style={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%', minWidth: 0, padding: 16, overflow: 'hidden' }}
        >
            <pre
                aria-hidden
                style={{
                    margin: 0,
                    fontFamily: 'monospace',
                    fontSize: 'clamp(8px, 0.8vw, 11px)',
                    lineHeight: 1.35,
                    fontWeight: 400,
                    letterSpacing: 0,
                    color: 'var(--muted-foreground)',
                    userSelect: 'none',
                }}
            >
                {skyline}
            </pre>
        </div>
    );
}

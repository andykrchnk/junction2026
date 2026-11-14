import { useEffect, useRef } from 'react';
import { background, constellation } from 'asciify-engine/kit';
import { BrandLogo } from '@/components/ui/brand-logo';

export function AuthHero() {
    const heroRef = useRef<HTMLElement>(null);
    const iconRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!heroRef.current || !iconRef.current) return;
        const backdrop = background(heroRef.current, {
            preset: constellation,
            clear: iconRef.current,
            charset: ' .:-=+YCIFSA#@',
            palette: 'var(--primary)',
            cursor: false,
        });
        return () => backdrop.destroy();
    }, []);

    return (
        <aside
            ref={heroRef}
            className="relative isolate hidden items-center justify-center overflow-hidden p-12 lg:flex"
            style={{ backgroundColor: 'var(--brand-black)' }}
        >
            <div ref={iconRef} className="relative z-10 flex items-center justify-center text-white">
                <BrandLogo iconOnly />
            </div>
        </aside>
    );
}

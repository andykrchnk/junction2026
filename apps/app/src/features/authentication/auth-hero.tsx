import { useEffect, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import { background, mesh } from 'asciify-engine/kit';
import { BrandLogo } from '@/components/ui/brand-logo';

export function AuthHero() {
    const heroRef = useRef<HTMLElement>(null);
    const copyRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!heroRef.current || !copyRef.current) return;
        const backdrop = background(heroRef.current, {
            preset: mesh,
            clear: copyRef.current,
            charset: ' .:-=+YCIFSA#@',
            ink: '#171717',
            opacity: 0.45,
        });
        return () => backdrop.destroy();
    }, []);

    return (
        <aside
            ref={heroRef}
            className="relative isolate hidden flex-col overflow-hidden p-12 text-white lg:flex"
            style={{ backgroundColor: 'color-mix(in srgb, var(--primary) 80%, black)' }}
        >
            <Link to="/login" className="relative z-10 flex w-fit items-center" aria-label="Pirtoa home">
                <BrandLogo />
            </Link>
            <div ref={copyRef} className="relative z-10 mt-auto max-w-md">
                <p className="mb-5 text-xs tracking-[0.18em] uppercase opacity-80">Built on evidence</p>
                <h2 className="text-4xl leading-tight font-medium tracking-tight">
                    Less searching.
                    <br />
                    More understanding.
                </h2>
                <p className="mt-5 text-sm leading-relaxed opacity-90">
                    Bring your construction drawings into one workspace. Make every answer traceable to its source.
                </p>
            </div>
        </aside>
    );
}

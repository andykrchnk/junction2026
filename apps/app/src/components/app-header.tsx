import { useState } from 'react';
import { BrandLogo } from '@repo/design-system/components/ui/brand-logo';
import { Button } from '@repo/design-system/components/ui/button';
import { DropdownMenu, DropdownTrigger, DropdownContent } from '@repo/design-system/components/ui/dropdown';
import { MenuItem } from '@repo/design-system/components/ui/menu-item';
import { LogOut } from '@repo/design-system/lib/icons-remix';
import '@/components/app-header.css';

export function AppHeader({ accountName = 'Oscar', onSignOut, onHome }: Readonly<{ accountName?: string; onSignOut?: () => void; onHome?: () => void }>) {
    const [accountOpen, setAccountOpen] = useState(false);
    return (
        <header className="sl-header">
            <a
                href="/"
                aria-label="Your sessions"
                className="inline-flex focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                onClick={
                    onHome
                        ? (event) => {
                              event.preventDefault();
                              onHome();
                          }
                        : undefined
                }
            >
                <BrandLogo className="sl-logo" />
            </a>
            <DropdownMenu open={accountOpen} onOpenChange={setAccountOpen}>
                <DropdownTrigger
                    render={
                        <Button variant="ghost" className="sl-account" aria-label="Account menu">
                            <span className="sl-avatar">{accountName.slice(0, 1).toUpperCase()}</span>
                        </Button>
                    }
                />
                <DropdownContent align="end">{onSignOut && <MenuItem index={0} label="Log out" trailingIcon={LogOut} onSelect={onSignOut} />}</DropdownContent>
            </DropdownMenu>
        </header>
    );
}

import iconUrl from "@repo/design-system/assets/pirto-icon.svg";
import logoUrl from "@repo/design-system/assets/pirto-logo.svg";

/** The supplied Pirto artwork inherits the surrounding foreground color. */
export function BrandLogo({ className = "", iconOnly = false }: Readonly<{ className?: string; iconOnly?: boolean }>) {
  return (
    <span
      role="img"
      aria-label="Pirto"
      className={`inline-block ${iconOnly ? "h-[128px] aspect-[218/240]" : "h-8 aspect-[780/240]"} shrink-0 bg-current ${className}`}
      style={{
        maskImage: `url(${JSON.stringify(iconOnly ? iconUrl : logoUrl)})`,
        maskSize: "contain",
        maskRepeat: "no-repeat",
        maskPosition: "center",
      }}
    />
  );
}

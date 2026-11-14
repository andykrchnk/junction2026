import logoUrl from "../../assets/verifico-logo.svg";

/** The supplied Verifico artwork inherits the surrounding foreground color. */
export function BrandLogo({ className = "" }: Readonly<{ className?: string }>) {
  return (
    <span
      role="img"
      aria-label="Verifico"
      className={`inline-block h-8 w-[139.2px] shrink-0 bg-current ${className}`}
      style={{
        maskImage: `url(${logoUrl})`,
        maskSize: "contain",
        maskRepeat: "no-repeat",
        maskPosition: "center",
      }}
    />
  );
}

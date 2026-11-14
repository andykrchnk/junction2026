import logoUrl from "../../assets/pirtoa-logo.svg";

/** The supplied Pirtoa artwork inherits the surrounding foreground color. */
export function BrandLogo({ className = "" }: Readonly<{ className?: string }>) {
  return (
    <span
      role="img"
      aria-label="Pirtoa"
      className={`inline-block h-8 aspect-[883/240] shrink-0 bg-current ${className}`}
      style={{
        maskImage: `url(${JSON.stringify(logoUrl)})`,
        maskSize: "contain",
        maskRepeat: "no-repeat",
        maskPosition: "center",
      }}
    />
  );
}

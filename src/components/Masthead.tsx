const LINKS = [
  { href: "#varieties", label: "Varieties" },
  { href: "#reading", label: "Reading" },
  { href: "#play", label: "Play" },
  { href: "#pond", label: "Pond" },
] as const;

export function Masthead() {
  return (
    <header className="masthead">
      <a className="masthead__brand" href="#top">
        <span className="jp masthead__mark" aria-hidden="true">
          錦
        </span>
        <span className="label label--tracked">Nishiki</span>
        <span className="sr-only">, back to top</span>
      </a>
      <nav aria-label="Sections">
        <ul className="masthead__nav">
          {LINKS.map((link) => (
            <li key={link.href}>
              <a className="masthead__link label" href={link.href}>
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

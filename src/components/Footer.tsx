export function Footer() {
  return (
    <footer className="footer">
      <div className="footer__brand">
        <span className="jp footer__mark" aria-hidden="true">
          錦
        </span>
        <p className="label label--tracked">Nishiki</p>
      </div>
      <div className="footer__cols">
        <p>
          <strong>A design concept.</strong> Nishiki is a fictional publisher, made up for a portfolio piece by Matt Klette. There
          is no shop, no subscription and no company behind it.
        </p>
        <p>
          Every fish on this page is drawn in code with Canvas 2D: no photographs, no generated images. Patterns are procedural, so
          the fish in the game are new every time.
        </p>
        <p>
          Variety notes are general reference for newcomers, not breeding or judging advice. Type: Bricolage Grotesque, Zen Kaku
          Gothic New and IBM Plex Mono, all under the SIL Open Font License.
        </p>
      </div>
      <div className="footer__base">
        <p className="label">© 2026 · Concept work, not a real brand</p>
        <a className="text-link label" href="#top">
          Back to the top
        </a>
      </div>
    </footer>
  );
}

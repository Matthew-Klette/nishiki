/**
 * Layout audit: loads the site in a same-origin iframe at each width and reports any text that
 * leaves the viewport, any content clipped inside an overflow-hidden box, and horizontal scroll.
 *
 * Run it in the browser console on the running site (dev or production build):
 *   paste this file, then: await auditOverflow()
 * Every width should report "clean".
 */
// Console snippet: defined here, called by whoever pastes it.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function auditOverflow(widths = [320, 360, 375, 414, 768, 1024, 1180, 1280, 1366, 1440, 1680, 1920, 2560]) {
  // Screen-reader-only text is clipped to 1px on purpose; closed dialogs and the curtain aren't rendered.
  const ignored = '[class*="sr-only"], dialog:not([open]), script, style, .intro-fallback';
  const SETTLE_MS = 2500;

  const audit = (win) => {
    const doc = win.document;
    const vw = doc.documentElement.clientWidth;
    const issues = new Set();

    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const range = doc.createRange();
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent.trim() || node.parentElement.closest(ignored)) continue;
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width && (rect.right > vw + 0.5 || rect.left < -0.5)) {
          issues.add(`offscreen "${node.textContent.trim().slice(0, 32)}" (${Math.round(rect.left)}→${Math.round(rect.right)}px)`);
        }
      }
    }

    doc.querySelectorAll("header *, main *, footer *").forEach((el) => {
      if (el.closest(ignored) || !el.textContent.trim() || el.querySelector("canvas, svg")) return;
      if (!/(hidden|clip)/.test(win.getComputedStyle(el).overflowX)) return;
      if (el.scrollWidth > el.clientWidth + 1) {
        issues.add(`clipped <${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 60)}"> by ${el.scrollWidth - el.clientWidth}px`);
      }
    });

    const horizontalScroll = doc.documentElement.scrollWidth - vw;
    if (horizontalScroll > 0) issues.add(`page scrolls sideways by ${horizontalScroll}px`);
    return [...issues];
  };

  const results = {};
  for (const width of widths) {
    const frame = document.createElement("iframe");
    frame.style.cssText = `position:fixed;inset:0 auto auto 0;width:${width}px;height:900px;opacity:0;pointer-events:none;border:0;z-index:-1`;
    frame.src = `${location.origin}/?audit=${width}`;
    document.body.appendChild(frame);
    await new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const issues = audit(frame.contentWindow);
    results[width] = issues.length ? issues : "clean";
    frame.remove();
  }
  console.table(results);
  return results;
}

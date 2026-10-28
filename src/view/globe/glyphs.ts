// Map symbols rendered as SVG data URIs.

const svgUri = (svg: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** Satellite symbol: bus with two solar arrays, in the constellation colour. */
export function satelliteGlyph(color: string): string {
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
  <g transform="rotate(-35 22 22)" stroke="#030612" stroke-width="1.5">
    <rect x="3" y="17" width="12" height="10" rx="1" fill="${color}" opacity="0.85"/>
    <rect x="29" y="17" width="12" height="10" rx="1" fill="${color}" opacity="0.85"/>
    <path d="M15 22h14" stroke="${color}" stroke-width="2"/>
    <rect x="17" y="15" width="10" height="14" rx="2" fill="#f4f6fa"/>
    <path d="M20 29v4h4v-4" fill="${color}"/>
  </g></svg>`);
}

/** Receiver pin with a crosshair. */
export function receiverGlyph(color: string): string {
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="56" height="72" viewBox="0 0 56 72">
  <path d="M28 70C28 70 6 42 6 26a22 22 0 0 1 44 0c0 16-22 44-22 44z" fill="#0a1020" stroke="${color}" stroke-width="3"/>
  <circle cx="28" cy="26" r="9" fill="none" stroke="${color}" stroke-width="3"/>
  <path d="M28 11v8M28 33v8M13 26h8M35 26h8" stroke="${color}" stroke-width="3" stroke-linecap="round"/>
</svg>`);
}

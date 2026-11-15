// Code 128 (set B) as an SVG path — no external library, scannable by ordinary USB/Bluetooth scanners.
const PATTERNS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212","112232","122132","122231","113222",
  "123122","123221","223211","221132","221231","213212","223112","312131","311222","321122","321221","312212","322112","322211","212123","212321",
  "232121","111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121",
  "313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111","314111","221411","431111","111224",
  "111422","121124","121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113",
  "114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112",
];
const START_B = 104;
const START_C = 105;
const CODE_B = 100; // switch to set B from set C
const STOP = 106;

const setB = (c: string) => {
  const v = c.charCodeAt(0) - 32;
  if (v < 0 || v > 94) throw new Error(`Character "${c}" cannot be printed in a barcode.`);
  return v;
};

// Digit-only values of 4+ digits use set C (two digits per symbol, about half the width); an odd last digit
// switches to set B. Everything else is set B. Both read the same on any Code 128 scanner.
function symbols(text: string) {
  if (/^\d{4,}$/.test(text)) {
    const even = text.length - (text.length % 2);
    const pairs = Array.from({ length: even / 2 }, (_, i) => Number(text.slice(i * 2, i * 2 + 2)));
    return even === text.length ? [START_C, ...pairs] : [START_C, ...pairs, CODE_B, setB(text[even])];
  }
  return [START_B, ...[...text].map(setB)];
}

// `quiet` is the blank margin each side, in bar widths (10 is the Code 128 minimum).
export function code128(text: string, quiet = 10) {
  const data = symbols(text);
  const checksum = data.reduce((sum, v, i) => sum + v * (i === 0 ? 1 : i), 0) % 103;
  const codes = [...data, checksum, STOP];
  let x = quiet;
  const bars: string[] = [];
  for (const code of codes) {
    const p = PATTERNS[code];
    for (let i = 0; i < p.length; i++) {
      const w = Number(p[i]);
      if (i % 2 === 0) bars.push(`M${x} 0h${w}v1h-${w}z`);
      x += w;
    }
  }
  return { path: bars.join(""), width: x + quiet };
}

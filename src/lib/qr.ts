/* Générateur de QR code (mode octets, niveau de correction M, versions 1 à 10) sans dépendance.
 * Suffisant pour un jeton de billet ou une adresse (jusqu'à 213 octets). Validé par décodage (OpenCV) sur plusieurs
 * longueurs ; en cas de texte trop long la fonction lève une erreur plutôt que d'afficher un code illisible. */

// [mots de code au total, mots de correction par bloc, blocs du groupe 1, données/bloc g1, blocs g2, données/bloc g2]
const VERSIONS: Record<number, [number, number, number, number, number, number]> = {
  1: [26, 10, 1, 16, 0, 0],
  2: [44, 16, 1, 28, 0, 0],
  3: [70, 26, 1, 44, 0, 0],
  4: [100, 18, 2, 32, 0, 0],
  5: [134, 24, 2, 43, 0, 0],
  6: [172, 16, 4, 27, 0, 0],
  7: [196, 18, 4, 31, 0, 0],
  8: [242, 22, 2, 38, 2, 39],
  9: [292, 22, 3, 36, 2, 37],
  10: [346, 26, 4, 43, 1, 44],
};
const ALIGN: Record<number, number[]> = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };

const dataCodewords = (v: number) => { const [, , b1, d1, b2, d2] = VERSIONS[v]!; return b1 * d1 + b2 * d2; };

/* ---------- Corps de Galois GF(256), polynôme 0x11D ---------- */
const EXP = new Array<number>(512);
const LOG = new Array<number>(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!; })();
const gmul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);

function generator(n: number): number[] {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array<number>(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { next[j] = next[j]! ^ gmul(g[j]!, 1); next[j + 1] = next[j + 1]! ^ gmul(g[j]!, EXP[i]!); }
    g = next;
  }
  return g; // coefficients du plus haut degré au plus bas
}

function remainder(data: number[], n: number): number[] {
  const g = generator(n);
  const res = new Array<number>(n).fill(0);
  for (const d of data) {
    const factor = d ^ res[0]!;
    res.shift();
    res.push(0);
    for (let i = 0; i < n; i++) res[i] = res[i]! ^ gmul(g[i + 1]!, factor);
  }
  return res;
}

/* ---------- Construction du flux de mots de code ---------- */
function utf8(text: string): number[] { return Array.from(new TextEncoder().encode(text)); }

function buildCodewords(bytes: number[], version: number): number[] {
  const cap = dataCodewords(version);
  const bits: number[] = [];
  const push = (value: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, cap * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]!; out.push(v); }
  for (let pad = 0xec; out.length < cap; pad ^= 0xec ^ 0x11) out.push(pad);

  const [, ecLen, b1, d1, b2, d2] = VERSIONS[version]!;
  const blocks: number[][] = [];
  let pos = 0;
  for (let i = 0; i < b1; i++) { blocks.push(out.slice(pos, pos + d1)); pos += d1; }
  for (let i = 0; i < b2; i++) { blocks.push(out.slice(pos, pos + d2)); pos += d2; }
  const ecs = blocks.map((b) => remainder(b, ecLen));
  const result: number[] = [];
  const maxData = Math.max(d1, d2);
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.length) result.push(b[i]!);
  for (let i = 0; i < ecLen; i++) for (const e of ecs) result.push(e[i]!);
  return result;
}

/* ---------- Matrice ---------- */
type Grid = { size: number; mod: boolean[][]; fn: boolean[][] };

function emptyGrid(version: number): Grid {
  const size = 17 + 4 * version;
  return { size, mod: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)), fn: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)) };
}
const setFn = (g: Grid, x: number, y: number, dark: boolean) => { if (x < 0 || y < 0 || x >= g.size || y >= g.size) return; g.mod[y]![x] = dark; g.fn[y]![x] = true; };

function drawFinder(g: Grid, cx: number, cy: number) {
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const d = Math.max(Math.abs(dx), Math.abs(dy));
    setFn(g, cx + dx, cy + dy, d !== 2 && d !== 4);
  }
}
function drawAlign(g: Grid, cx: number, cy: number) {
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(g, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
}

function bch(value: number, poly: number, polyBits: number, valueBits: number): number {
  let v = value << (polyBits - 1);
  for (let i = valueBits + polyBits - 2; i >= polyBits - 1; i--) if ((v >>> i) & 1) v ^= poly << (i - (polyBits - 1));
  return (value << (polyBits - 1)) | v;
}

function drawFormat(g: Grid, mask: number) {
  const data = (0b00 << 3) | mask; // niveau M = 00
  const bits = (bch(data, 0x537, 11, 5) ^ 0x5412) & 0x7fff;
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) setFn(g, 8, i, bit(i));
  setFn(g, 8, 7, bit(6)); setFn(g, 8, 8, bit(7)); setFn(g, 7, 8, bit(8));
  for (let i = 9; i < 15; i++) setFn(g, 14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) setFn(g, g.size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) setFn(g, 8, g.size - 15 + i, bit(i));
  setFn(g, 8, g.size - 8, true);
}

function drawVersion(g: Grid, version: number) {
  if (version < 7) return;
  const bits = bch(version, 0x1f25, 13, 6);
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) === 1;
    const a = g.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFn(g, a, b, dark);
    setFn(g, b, a, dark);
  }
}

function drawFunctionPatterns(g: Grid, version: number) {
  for (let i = 0; i < g.size; i++) { setFn(g, 6, i, i % 2 === 0); setFn(g, i, 6, i % 2 === 0); }
  drawFinder(g, 3, 3); drawFinder(g, g.size - 4, 3); drawFinder(g, 3, g.size - 4);
  const pos = ALIGN[version]!;
  for (let i = 0; i < pos.length; i++) for (let j = 0; j < pos.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
    drawAlign(g, pos[i]!, pos[j]!);
  }
  drawFormat(g, 0); // réserve la zone (réécrite après le choix du masque)
  drawVersion(g, version);
}

function placeData(g: Grid, codewords: number[]) {
  let i = 0;
  const total = codewords.length * 8;
  for (let right = g.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < g.size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j;
      const upward = ((right + 1) & 2) === 0;
      const y = upward ? g.size - 1 - vert : vert;
      if (!g.fn[y]![x] && i < total) { g.mod[y]![x] = ((codewords[i >>> 3]! >>> (7 - (i & 7))) & 1) === 1; i++; }
    }
  }
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(g: Grid, mask: number) {
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) if (!g.fn[y]![x] && MASKS[mask]!(x, y)) g.mod[y]![x] = !g.mod[y]![x];
}

function penalty(g: Grid): number {
  const n = g.size;
  let score = 0;
  const lines: boolean[][] = [];
  for (let y = 0; y < n; y++) lines.push(g.mod[y]!);
  for (let x = 0; x < n; x++) lines.push(g.mod.map((row) => row[x]!));
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i < n; i++) {
      if (line[i] === line[i - 1]) { run++; if (run === 5) score += 3; else if (run > 5) score += 1; } else run = 1;
    }
    // motif 1:1:3:1:1 encadré de blancs
    for (let i = 0; i + 10 < n; i++) {
      const w = line.slice(i, i + 11).map((b) => (b ? 1 : 0)).join("");
      if (w === "10111010000" || w === "00001011101") score += 40;
    }
  }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) { const c = g.mod[y]![x]; if (c === g.mod[y]![x + 1] && c === g.mod[y + 1]![x] && c === g.mod[y + 1]![x + 1]) score += 3; }
  let dark = 0;
  for (const row of g.mod) for (const c of row) if (c) dark++;
  score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return score;
}

/** Renvoie la matrice du QR code (true = module sombre). Lève une erreur si le texte dépasse la capacité (213 octets). */
export function qrMatrix(text: string): boolean[][] {
  const bytes = utf8(text);
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const lenBits = v <= 9 ? 8 : 16;
    if (4 + lenBits + bytes.length * 8 <= dataCodewords(v) * 8) { version = v; break; }
  }
  if (!version) throw new Error("Texte trop long pour le QR code");
  const codewords = buildCodewords(bytes, version);
  let best: Grid | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const g = emptyGrid(version);
    drawFunctionPatterns(g, version);
    placeData(g, codewords);
    applyMask(g, mask);
    drawFormat(g, mask);
    const p = penalty(g);
    if (p < bestScore) { bestScore = p; best = g; }
  }
  return best!.mod;
}

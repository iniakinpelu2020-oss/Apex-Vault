// Password generation and a rough strength estimate.
const SETS = {
  lower: "abcdefghijklmnopqrstuvwxyz",
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.?/",
};

function pick(alphabet) {
  // Rejection sampling keeps every character equally likely.
  const max = 256 - (256 % alphabet.length);
  const buf = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < max) return alphabet[buf[0] % alphabet.length];
  }
}

export function generate({ length = 20, upper = true, lower = true, digits = true, symbols = true } = {}) {
  const pools = [];
  if (lower) pools.push(SETS.lower);
  if (upper) pools.push(SETS.upper);
  if (digits) pools.push(SETS.digits);
  if (symbols) pools.push(SETS.symbols);
  if (!pools.length) pools.push(SETS.lower);
  const all = pools.join("");
  const chars = pools.map((p) => pick(p));
  while (chars.length < Math.max(length, pools.length)) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export function strength(password) {
  const pw = String(password || "");
  if (!pw) return { score: 0, label: "empty" };
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 30;
  const bits = Math.round(pw.length * Math.log2(pool || 1));
  const label = bits < 40 ? "weak" : bits < 60 ? "fair" : bits < 80 ? "strong" : "excellent";
  return { score: bits, label };
}

export function slug(label, fallback) {
  const s = String(label || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s || fallback || "entry";
}

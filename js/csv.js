// RFC 4180 CSV reader plus column guessing for the exports people actually have:
// Chrome, Bitwarden, LastPass (csv) and 1Password (csv).

export function detectDelimiter(text) {
  const firstLine = text.slice(0, text.indexOf("\n") === -1 ? text.length : text.indexOf("\n"));
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const ch of firstLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch]++;
  }
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || ",";
}

export function parseCsv(text, delimiter) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

const PATTERNS = {
  label: /^(name|title|account|account name|item|item name|login name)$/,
  username: /^(username|user name|login|login username|user|email|e mail)$/,
  password: /^(password|login password|pass|pwd|secret)$/,
  url: /^(url|uri|login uri|website|web site|site|link)$/,
  notes: /^(note|notes|comment|comments|extra|memo|description)$/,
};

// "login_username" -> "login username", so Bitwarden and Chrome headers both match.
function normalize(header) {
  return String(header)
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/[_\-.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function guessMapping(headers) {
  const map = { label: "", username: "", password: "", url: "", notes: "" };
  const normalized = headers.map((h) => String(h).trim());
  for (const key of Object.keys(PATTERNS)) {
    const hit = normalized.find((h) => PATTERNS[key].test(normalize(h)));
    if (hit) map[key] = hit;
  }
  if (!map.label && !map.username && !map.password) {
    // Positional fallback for headerless exports: name,url,user,pass
    if (normalized.length >= 4) {
      map.label = normalized[0];
      map.url = normalized[1];
      map.username = normalized[2];
      map.password = normalized[3];
    }
  }
  return map;
}

export function rowsToRecords(rows, mapping) {
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map((h) => String(h).trim());
  const index = {};
  for (const [key, header] of Object.entries(mapping)) {
    const at = headers.indexOf(String(header).trim());
    if (header && at !== -1) index[key] = at;
  }
  const records = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const get = (key) => (index[key] === undefined ? "" : String(cells[index[key]] ?? "").trim());
    const record = {
      label: get("label"),
      username: get("username"),
      password: get("password"),
      url: get("url"),
      notes: get("notes"),
    };
    if (!record.label && !record.username && !record.password) continue;
    if (!record.label) record.label = record.url || record.username || "Untitled";
    records.push(record);
  }
  return { headers, records };
}

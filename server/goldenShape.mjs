// The SHAPE of a payload: every key path with the type of its value, sorted.
//
// Golden fixtures over raw payloads are unusable here -- `generatedAt`, temp paths and GitHub
// enrichment all vary per run, so a byte-comparison would fail constantly and be disabled within a
// week. The shape is the part that is actually a contract: a consumer breaks when a key disappears
// or changes type, not when a timestamp moves.
//
// Arrays collapse to their first element's shape under `[]`, so a two-element list and a
// twenty-element list of the same objects agree.

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function shapeOf(value, prefix = "") {
  const kind = typeOf(value);
  if (kind === "array") {
    if (!value.length) return [`${prefix}[]: empty`];
    return shapeOf(value[0], `${prefix}[]`);
  }
  if (kind !== "object") return [`${prefix}: ${kind}`];
  const out = [];
  for (const key of Object.keys(value).sort()) {
    out.push(...shapeOf(value[key], prefix ? `${prefix}.${key}` : key));
  }
  return out;
}

export function shapeLines(value) {
  return shapeOf(value).sort();
}

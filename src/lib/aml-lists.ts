// International sanctions-list search — no API key required.
// Sources (free, authoritative, cached locally with a weekly TTL):
//  1) OFAC SDN List (US Treasury)  — XML, ~19k entries + aliases
//  2) UN Security Council Consolidated List (SCSAN) — XML (individuals+entities)
//
// Matching supports both Latin and Arabic queries. Arabic tokens are
// transliterated into Latin variants, then compared with each entry's name +
// alias tokens via normalized Levenshtein similarity, so common spelling
// differences (قذافي -> QADHAFI/GADDAFI/QADDAFI...) are caught.

import { promises as fs } from "node:fs";
import path from "node:path";

export interface SanctionListHit {
  list: "OFAC SDN" | "UN Consolidated";
  fullName: string;
  type: "Individual" | "Entity" | "Vessel" | "Aircraft";
  programs: string[];
  confidence: number;
  /** True when the match is inferred (cross-script skeleton / partial coverage) and needs an auditor's manual check. */
  needsReview?: boolean;
  reference?: string;
  uri: string;
}

interface SanctionEntry {
  list: SanctionListHit["list"];
  nameTokens: string[];
  fullName: string;
  type: string;
  programs: string[];
  reference?: string;
  uid?: string;
}

const CACHE_DIR = path.resolve(process.env.AML_CACHE_DIR ?? process.cwd(), ".aml-cache");
const SDN_FILE = "sdn.xml";
const UN_FILE = "un-consolidated.xml";
const SDN_URL = "https://www.treasury.gov/ofac/downloads/sdn.xml";
const UN_URL = "https://scsanctions.un.org/resources/xml/en/consolidated.xml";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 45_000;
const MAX_LIST_BYTES = 200 * 1024 * 1024;

const UA = "DabourAML/1.0 (AML compliance screener; contact: local)";

// Very common given names / particles: a hit on these ALONE is never enough
// evidence to flag someone (mirrors the anti-false-positive gate used by the
// live online screener in aml-online.ts).
const GENERIC_TOKENS = new Set([
  "محمد", "احمد", "علي", "حسن", "حسين", "خالد", "سعيد", "مصطفي", "محمود",
  "ابراهيم", "اسماعيل", "عبد", "عبدالله", "عمر", "عمرو", "سالم", "سليم",
  "سليمان", "صالح", "يوسف", "يحيي", "ناصر", "هشام", "وائل", "امين", "سامي",
  "ابو", "ابي", "ابن", "بن", "ال", "the", "and", "of", "bin", "ibn", "abd",
  "abdul", "al", "el", "la", "le", "de", "van", "von", "inc", "corp", "co",
  "ltd", "llc", "mohamed", "mohammed", "muhammad", "ahmed", "ahmad", "ali",
  "hasan", "hassan", "hussein", "husain", "khalid", "said", "omar", "amr",
  "salem", "salim", "suleiman", "sulaiman", "saleh", "salih", "yousef",
  "yusuf", "yahya", "nasser", "naser", "hesham", "hisham", "amin", "ameen",
  "sami",
]);

const MATCH_THRESHOLD = 0.85; // per-token Levenshtein similarity (name forms)
const SKELETON_THRESHOLD = 0.95; // per-token consonant-skeleton similarity (cross-script)
const MIN_COVERAGE = 0.6; // share of the query tokens that must be found

const AR2LAT: Record<string, string[]> = {
  "ا": ["a"], "أ": ["a"], "إ": ["a"], "آ": ["a"], "ب": ["b"],
  "ت": ["t"], "ث": ["th", "s", "t"], "ج": ["j", "g"], "ح": ["h"],
  "خ": ["kh", "k", "h"], "د": ["d"], "ذ": ["th", "z", "d"], "ر": ["r"],
  "ز": ["z"], "س": ["s"], "ش": ["sh", "ch"], "ص": ["s"], "ض": ["d", "dh"],
  "ط": ["t"], "ظ": ["th", "z"], "ع": ["a", "e", "o"], "غ": ["gh", "g"],
  "ف": ["f"], "ق": ["q", "g", "k"], "ك": ["k", "c"], "ل": ["l"],
  "م": ["m"], "ن": ["n"], "ه": ["h"], "و": ["w", "o", "u"],
  "ي": ["y", "i"], "ة": ["a", "h"], "ى": ["y", "a"],
};

let entries: SanctionEntry[] | null = null;
let loadPromise: Promise<void> | null = null;
let lastError: string | null = null;

export function isListsReady(): boolean {
  return entries !== null;
}

export function listsSourceSummary(): string {
  return entries ? `Sanctions lists loaded: ${entries.length} entries` : "Sanctions lists not loaded yet";
}

export function listsLoadError(): string | null {
  return lastError;
}

export function ensureListsLoaded(): void {
  if (!loadPromise) loadPromise = loadLists();
}

function hasArabic(s: string): boolean {
  return /[\u0600-\u06FF]/.test(s);
}

function normLatin(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/gi, " ").trim();
}

function tokenize(s: string): string[] {
  return normLatin(s).split(/\s+/).filter((t) => t.length >= 2);
}

function stripDiacritics(s: string): string {
  return s.replace(/[\u064B-\u0652\u0670\u0640]/g, "");
}

function coreAr(token: string): string {
  return stripDiacritics(token)
    .replace(/[\u0623\u0625\u0622\u0671]/g, "\u0627")
    .replace(/\u0626/g, "\u064a")
    .replace(/\u0624/g, "\u0648")
    .replace(/\u0629/g, "\u0647")
    .replace(/\u0649/g, "\u064a")
    .replace(/^\u0627\u0644/g, "");
}

// ─── Transliteration & fuzzy matching ───────────────────────────────────────

/** Bounded cartesian product of the Arabic→Latin variants of ONE token. */
function transliterateAr(token: string): string[] {
  let out: string[] = [""];
  for (const ch of coreAr(token)) {
    const opts = AR2LAT[ch] ?? [ch];
    const next: string[] = [];
    for (const prefix of out) {
      for (const o of opts) {
        next.push(prefix + o);
        if (next.length >= 24) break; // keep the variant set bounded
      }
      if (next.length >= 24) break;
    }
    out = next;
  }
  return Array.from(new Set(out)).filter((v) => v.length >= 2);
}

/** Full-name comparison forms for one query token (no skeletons). */
function queryTokenKeys(token: string): string[] {
  if (!hasArabic(token)) return [normLatin(token)];
  return Array.from(new Set([coreAr(token), ...transliterateAr(token)])).filter(Boolean);
}

/** Normalised Levenshtein similarity (0..1). */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > Math.max(m, n) * 0.5) return 0;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

// ─── Consonant skeletons (Arabic ⇄ Latin cross-script matching) ──────────────
// Latin transcriptions of Arabic names vary wildly (قذافي -> QADHAFI / GADDAFI /
// KADHAFI), so comparing the raw letters fails. Comparing the CONSONANT
// skeleton instead is the standard trick: drop vowels/glides, fold digraphs
// (dh, kh, gh, th, sh…), and allow the few consonants whose Latin spelling is
// ambiguous (ق = q/g/k, ذ = d/z, …) as alternatives.

/** Canonical consonant per Arabic letter ("" = vowel/glide, dropped). */
const AR_CONSONANT: Record<string, string> = {
  "ب": "b", "ت": "t", "ث": "t", "ج": "j", "ح": "h", "خ": "k", "د": "d",
  "ذ": "d", "ر": "r", "ز": "z", "س": "s", "ش": "s", "ص": "s", "ض": "d",
  "ط": "t", "ظ": "d", "ع": "", "غ": "g", "ف": "f", "ق": "q", "ك": "k",
  "ل": "l", "م": "m", "ن": "n", "ه": "h", "و": "", "ي": "", "ا": "",
  "ة": "", "ى": "", "ء": "",
};

/** Arabic letters whose Latin consonant is ambiguous (or removable, ه). */
const AR_CONSONANT_ALTS: Record<string, string[]> = {
  "ق": ["q", "g", "k"], "ذ": ["d", "z"], "ث": ["t", "s"], "ج": ["j", "g"],
  "خ": ["k", "h"], "ظ": ["d", "z"], "ض": ["d", "z"], "غ": ["g", "k"],
  "ه": ["h", ""],
};

const LAT_DIGRAPHS: Array<[RegExp, string]> = [
  [/kh/g, "k"], [/gh/g, "g"], [/ch/g, "c"], [/sh/g, "s"], [/th/g, "t"],
  [/dh/g, "d"], [/ph/g, "f"], [/ck/g, "k"], [/qu/g, "k"],
];

/** Consonant skeleton of a Latin token: as-is + doubled letters collapsed. */
function latinSkeletons(token: string): string[] {
  let t = normLatin(token);
  for (const [re, rep] of LAT_DIGRAPHS) t = t.replace(re, rep);
  const skel = t.replace(/[aeiouy]+/g, "");
  return Array.from(new Set([skel, skel.replace(/(.)\1+/g, "$1")]))
    .filter((s) => s.length >= 2);
}

/** Bounded set of consonant skeletons for an Arabic (core-normalised) token. */
function arSkeletons(token: string): string[] {
  let out: string[] = [""];
  for (const ch of token) {
    if (!(ch in AR_CONSONANT)) continue;
    const opts = AR_CONSONANT_ALTS[ch] ?? [AR_CONSONANT[ch]];
    const next: string[] = [];
    for (const prefix of out) for (const o of opts) next.push(prefix + o);
    out = next.slice(0, 12); // keep the variant set bounded
  }
  return Array.from(new Set(out)).filter((s) => s.length >= 2);
}

/** Consonant skeletons for an Arabic query token (cross-script matching). */
function arabicQuerySkeletons(token: string): string[] {
  return hasArabic(token) ? arSkeletons(coreAr(token)) : [];
}

/** Every comparison form stored for a name token (script + skeleton). */
function tokenVariants(raw: string): string[] {
  if (hasArabic(raw)) {
    const core = coreAr(raw);
    return Array.from(new Set([core, ...arSkeletons(core)]));
  }
  const latin = normLatin(raw);
  return Array.from(new Set([latin, ...latinSkeletons(latin)]));
}

// ─── XML parsing (dependency-free) ──────────────────────────────────────────

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

function tag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? decodeXmlEntities(m[1]).trim() : undefined;
}

function allTags(block: string, name: string): string[] {
  const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) out.push(decodeXmlEntities(m[1]).trim());
  return out;
}

/** Reduce a set of Latin/Arabic names to comparable tokens. */
function nameTokensFrom(names: Array<string | undefined>): string[] {
  const tokens = new Set<string>();
  for (const raw of names) {
    if (!raw) continue;
    for (const t of tokenize(raw)) for (const v of tokenVariants(t)) tokens.add(v);
  }
  return Array.from(tokens).filter((t) => t.length >= 2);
}

function parseSdn(xml: string): SanctionEntry[] {
  const out: SanctionEntry[] = [];
  for (const b of xml.match(/<sdnEntry>[\s\S]*?<\/sdnEntry>/g) ?? []) {
    const last = tag(b, "lastName");
    const first = tag(b, "firstName");
    const fullName = [first, last].filter(Boolean).join(" ").trim();
    if (!fullName) continue;
    const names: Array<string | undefined> = [fullName];
    for (const aka of b.match(/<aka>[\s\S]*?<\/aka>/g) ?? []) {
      names.push(tag(aka, "firstName"), tag(aka, "lastName"));
    }
    out.push({
      list: "OFAC SDN",
      nameTokens: nameTokensFrom(names),
      fullName,
      type: tag(b, "sdnType") ?? "Entity",
      programs: allTags(b, "program"),
      uid: tag(b, "uid"),
    });
  }
  return out;
}

function parseUn(xml: string): SanctionEntry[] {
  const out: SanctionEntry[] = [];
  for (const b of xml.match(/<(INDIVIDUAL|ENTITY)>[\s\S]*?<\/\1>/g) ?? []) {
    const isIndividual = b.startsWith("<INDIVIDUAL>");
    const parts = [
      tag(b, "FIRST_NAME"),
      tag(b, "SECOND_NAME"),
      tag(b, "THIRD_NAME"),
      tag(b, "FOURTH_NAME"),
    ].filter(Boolean) as string[];
    // UN quirk: for ENTITY blocks FIRST_NAME holds the organisation name.
    const fullName = parts.join(" ").trim();
    if (!fullName) continue;
    const aliasTag = isIndividual ? "INDIVIDUAL_ALIAS" : "ENTITY_ALIAS";
    const aliases = (b.match(new RegExp(`<${aliasTag}>[\\s\\S]*?</${aliasTag}>`, "g")) ?? [])
      .map((a) => tag(a, "ALIAS_NAME"));
    const original = tag(b, "NAME_ORIGINAL_SCRIPT");
    out.push({
      list: "UN Consolidated",
      nameTokens: nameTokensFrom([fullName, original, ...aliases]),
      fullName,
      type: isIndividual ? "Individual" : "Entity",
      programs: [tag(b, "UN_LIST_TYPE"), tag(b, "LIST_TYPE")].filter(Boolean) as string[],
      reference: tag(b, "REFERENCE_NUMBER"),
      uid: tag(b, "DATAID"),
    });
  }
  return out;
}

// ─── Cache + download ───────────────────────────────────────────────────────

async function readFreshCache(file: string): Promise<string | null> {
  try {
    const full = path.join(CACHE_DIR, file);
    const st = await fs.stat(full);
    if (Date.now() - st.mtimeMs > TTL_MS) return null;
    return await fs.readFile(full, "utf8");
  } catch {
    return null;
  }
}

async function writeCache(file: string, xml: string): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(path.join(CACHE_DIR, file), xml, "utf8");
  } catch {
    // Cache write failures must never break screening.
  }
}

async function download(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/xml,text/xml,*/*" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > 1000 && text.length <= MAX_LIST_BYTES ? text : null;
  } catch {
    return null;
  }
}

/** Fresh cache if available, otherwise download and refresh the cache. */
async function fetchList(url: string, file: string): Promise<string | null> {
  const cached = await readFreshCache(file);
  if (cached) return cached;
  const fresh = await download(url);
  if (fresh) await writeCache(file, fresh);
  return fresh;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Download (or reuse the weekly cache) and parse both lists. Never throws. */
export async function loadLists(): Promise<void> {
  lastError = null;
  try {
    const [sdnXml, unXml] = await Promise.all([
      fetchList(SDN_URL, SDN_FILE),
      fetchList(UN_URL, UN_FILE),
    ]);
    const parsed = [
      ...(sdnXml ? parseSdn(sdnXml) : []),
      ...(unXml ? parseUn(unXml) : []),
    ];
    if (!parsed.length) {
      lastError = "Sanctions lists unavailable (offline and no local cache)";
      return;
    }
    entries = parsed;
    console.log(`[aml-lists] loaded ${parsed.length} sanctions entries (OFAC SDN + UN Consolidated)`);
  } catch (err) {
    lastError = err instanceof Error ? err.message : "unknown error";
  }
}

/**
 * Search the loaded sanctions lists for a name (Latin or Arabic).
 * Returns [] until the lists are loaded — call `ensureListsLoaded()` first so
 * the download happens in the background and never blocks a request.
 */
export function searchSanctionsList(query: string, limit = 5): SanctionListHit[] {
  if (!entries || !query?.trim()) return [];
  const qTokens = tokenize(query)
    .map((t) => ({
      keys: queryTokenKeys(t),
      // Skeletons are used for Arabic queries only (cross-script matching
      // against the Latin-only OFAC/UN names). For Latin queries they would
      // only add short-skeleton false positives.
      skeletons: arabicQuerySkeletons(t),
      // A generic given name is only usable together with another token.
      generic: GENERIC_TOKENS.has(hasArabic(t) ? coreAr(t) : normLatin(t)),
    }))
    .filter((t) => t.keys.length > 0);
  if (!qTokens.length) return [];

  // Screening eligibility is decided ONLY by distinctive tokens (a generic given
  // name is never evidence on its own), so coverage is measured over those. A
  // query made exclusively of generic names therefore returns no hit.
  const distinctiveTokens = qTokens.filter((t) => !t.generic);
  const genericTokens = qTokens.filter((t) => t.generic);
  if (!distinctiveTokens.length) return [];

  const bestOf = (candidates: string[], nameTokens: string[]) => {
    let best = 0;
    for (const key of candidates) {
      for (const et of nameTokens) {
        const s = similarity(key, et);
        if (s > best) best = s;
        if (best === 1) return best;
      }
    }
    return best;
  };

  const scored: Array<{ score: number; hit: SanctionListHit }> = [];
  for (const e of entries) {
    let formMatched = 0;
    let skeletonMatched = 0;
    let similaritySum = 0;
    let closenessSum = 0;

    for (const { keys, skeletons } of distinctiveTokens) {
      // Sub-threshold spelling closeness (e.g. Arabic "خامنئي" -> "khamnyy"
      // against "KHAMENEI" = 0.63) cannot prove a match, but it is a strong
      // ranking signal between two same-skeleton candidates.
      const closest = bestOf(keys, e.nameTokens);
      closenessSum += closest;
      if (closest >= MATCH_THRESHOLD) {
        formMatched++;
        similaritySum += closest;
        continue;
      }
      const bestSkeleton = skeletons.length ? bestOf(skeletons, e.nameTokens) : 0;
      if (bestSkeleton >= SKELETON_THRESHOLD) {
        skeletonMatched++;
        similaritySum += bestSkeleton * 0.9;
      }
    }

    const matched = formMatched + skeletonMatched;
    if (!matched) continue;
    const coverage = matched / distinctiveTokens.length;
    if (coverage < MIN_COVERAGE) continue;
    // A skeleton-only hit is a cross-script inference: require the whole name
    // to be covered and flag it for manual verification.
    const skeletonOnly = formMatched === 0;
    if (skeletonOnly && coverage < 1) continue;

    // Generic tokens never grant eligibility, but a corroborating given name
    // ("Ali" in "علي خامنئي" -> "Ali Husseini KHAMENEI") is a strong ranking
    // signal that separates the real subject from same-skeleton noise.
    const corroborating = genericTokens.filter(
      (t) => bestOf(t.keys, e.nameTokens) >= MATCH_THRESHOLD,
    ).length;

    scored.push({
      // Form matches always outrank skeleton-only (cross-script) matches;
      // corroborating names, coverage, spelling closeness and average
      // similarity only order within a tier.
      score:
        formMatched * 1_000_000 +
        corroborating * 100_000 +
        coverage * 1000 +
        (closenessSum / distinctiveTokens.length) * 100 +
        (similaritySum / matched) * 10,
      hit: {
        list: e.list,
        fullName: e.fullName,
        type: (["Individual", "Entity", "Vessel", "Aircraft"].includes(e.type)
          ? e.type
          : "Entity") as SanctionListHit["type"],
        programs: e.programs,
        confidence: Math.round((similaritySum / matched) * 100),
        needsReview: skeletonOnly || coverage < 1,
        reference: e.reference ?? e.uid,
        uri: e.list === "UN Consolidated"
          ? `https://scsanctions.un.org/search/?q=${encodeURIComponent(e.fullName)}`
          : `https://sanctionssearch.ofac.treas.gov/Details.aspx?id=${encodeURIComponent(e.uid ?? "")}`,
      },
    });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.hit);
}




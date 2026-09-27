// Automatic online AML/CFT look-up that runs with no API key.
// Uses Wikipedia's public API (JSON, no authentication) as a free,
// always-available "search the internet" step. For the top search hits it
// inspects the article's CATEGORIES, which reliably surface international
// designations such as "subject to U.S. Treasury sanctions", "terrorism",
// "International Criminal Court", "wanted", etc. This lets any name be
// screened automatically while the device is online, without maintaining a
// hard-coded list.

export interface AmlOnlineHit {
  fullName: string;
  nationality: string;
  type: "Individual" | "Entity";
  listSource: string;
  status: "Flagged" | "Clear";
  riskScore: number;
  details: string;
  sources: { title: string; uri: string }[];
  matchBasis?: {
    article: string;
    category: string;
    confidence: number; // 0..100 name-overlap confidence
    needsReview: boolean; // partial identity -> manual verification required
  };
}

const WIKI_ORIGIN = "https://en.wikipedia.org";
const WIKI_AR = "https://ar.wikipedia.org";
const UA = "DabourAML/1.0 (AML compliance screener; contact: local)";

const CAT_KEYWORDS_EN = [
  "international criminal court",
  "sanction", "sancion", "terrorism", "terrorist",
  "fugitive", "wanted", "red notice", "rednotice",
  "designated", "convicted", "money launder",
  "war crime", "embargo", "subject to u.s.",
  "subject to united states", "department of the treasury",
  "department of state", "eu sanctions", "proscribed",
  "al-qaeda", "al-qaida", "isis", "islamic state",
  "genocide", "jihadist", "extradition",
];

const CAT_KEYWORDS_AR = [
  "محكمة الجنايات الدولية", "محكمة جنائية دولية",
  "عقوبات", "إرهاب", "ارهاب", "إرهابي", "ارهابي",
  "مطلوب", "متهم", "مدان", "غسيل أموال", "جريمة",
  "ملاحقة", "تجميد", "تحفظ",
  "تنظيم الدولة", "داعش", "الإبادة الجماعية", "قتلة جماعيون",
  "جهادي", "جهاديون", "العدوان",
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasArabic(s: string): boolean {
  return /[\u0600-\u06FF]/.test(s);
}

// Common Arabic/English given names & particles that are NOT distinctive enough
// to prove the queried person IS the article's subject. Removing them prevents
// false positives where a shared given name drags in an unrelated flagged page
// (e.g. "سالم ... سليمان الاقرع" sharing "سليمان" with "صالح سليمان العاروري").
// NOTE: values are stored in "core" (Arabic-normalised) form.
const STOPWORDS = new Set([
  // Arabic first names (very common)
  "محمد", "احمد", "عبد", "علي", "حسن", "حسين", "خالد", "سعيد",
  "مصطفي", "محمود", "ابراهيم", "اسماعيل", "سيد", "سليم", "سليمان",
  "صالح", "عمر", "عمرو", "طارق", "عادل", "عباس", "فتحي", "كريم",
  "محسن", "منصور", "ناصر", "هشام", "وائل", "يوسف", "يحيي", "سالم",
  "رامي", "نور", "بهاء", "ايمن", "اسامه", "اشرف", "امين", "حسني",
  "خليل", "جمال", "سمير", "عادل", "عبدالله", "اسامه", "معتصم",
  // Arabic particles / construct forms
  "ابو", "ابي", "ابن", "بن", "ام", "ال",
  // English particles / common first names / company tags
  "the", "and", "of", "inc", "corp", "co", "ltd", "llc",
  "de", "la", "le", "el", "al", "bin",
]);

// Titles that are not a single person/entity are never used as evidence.
const NOISE_TITLE_SIGNALS = [
  "توضيح", "قائمة", "مسلسل", "فيلم", "تصفح", "قالب", "بوابة", "تصنيف", "دلالة",
];

function stripDiacritics(s: string): string {
  return s.replace(/[\u064B-\u0652\u0670\u0640]/g, "");
}

// Normalise an Arabic token: hamzas -> alif, taa marbuta -> haa, alif maqsura
// -> yaa, drop leading definite article "ال". English tokens are lowercased.
function coreToken(token: string): string {
  let t = normalize(stripDiacritics(token));
  if (hasArabic(t)) {
    t = t.replace(/[أإآٱ]/g, "ا");
    t = t.replace(/ة/g, "ه");
    t = t.replace(/ى/g, "ي");
    t = t.replace(/^ال/g, "");
  }
  return t.trim();
}

function tokenizeName(s: string): string[] {
  return normalize(s).split(/\s+/).filter((t) => t.length > 1);
}

// How strongly the query and an article TITLE refer to the same person.
function nameRelevance(query: string, title: string): {
  sharedDistinct: string[];
  coverageMin: number; // shared / min(queryTokens, titleTokens)
  titleCoverage: number; // shared / titleTokens (how much of the article name is covered)
  qCoreCount: number; // number of distinctive (non-stopword) query tokens
} {
  const qCore = Array.from(new Set(tokenizeName(query).map(coreToken))).filter((t) => !STOPWORDS.has(t));
  const tCore = Array.from(new Set(tokenizeName(title).map(coreToken).filter((t) => !STOPWORDS.has(t))));
  const qSet = new Set(qCore);
  const sharedDistinct = tCore.filter((t) => qSet.has(t));
  const coverageMin = sharedDistinct.length / Math.max(1, Math.min(qCore.length, tCore.length));
  const titleCoverage = tCore.length ? sharedDistinct.length / tCore.length : 0;
  return { sharedDistinct, coverageMin, titleCoverage, qCoreCount: qCore.length };
}

async function wikiFetch(url: string): Promise<any | undefined> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept": "application/json" },
        // Bounded: a hung upstream must never stall the screening request.
        signal: AbortSignal.timeout(12_000),
      });
      if (res.ok) return await res.json();
      // 429/5xx -> Wikipedia throttle/transient: retry once after a short pause.
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 350));
        continue;
      }
      return undefined;
    } catch {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 350));
        continue;
      }
      return undefined;
    }
  }
  return undefined;
}

export async function screenOnline(query: string): Promise<AmlOnlineHit | undefined> {
  const q = normalize(query);
  if (q.length < 3) return undefined;

  const origin = hasArabic(query) ? WIKI_AR : WIKI_ORIGIN;
  const kwList = hasArabic(query) ? CAT_KEYWORDS_AR : CAT_KEYWORDS_EN;

  // 1) Find candidate articles for this name.
  const searchUrl =
    `${origin}/w/api.php?action=query&list=search&srlimit=6&format=json&srsearch=${encodeURIComponent(query)}`;
  const data = await wikiFetch(searchUrl);
  const hits: { title: string }[] = data?.query?.search ?? [];
  if (!hits.length) return undefined;

  // 2) Score candidates by NAME RELEVANCE first, then inspect categories ONLY of
  // articles that plausibly belong to the queried person. This prevents false
  // positives where a shared common name pulls in an unrelated flagged page
  // (e.g. "سالم حسن محمد سليمان الاقرع" vs "صالح سليمان العاروري").
  const titles = hits.map((h) => h.title).slice(0, 6);
  let matchedTitle = "";
  let matchedCat = "";
  let matchedUri = "";
  let confidence = 0;
  let needsReview = false;
  for (const title of titles) {
    const normTitle = normalize(title);
    // Skip disambiguation / list / media pages.
    if (NOISE_TITLE_SIGNALS.some((s) => normTitle.includes(s))) continue;

    // ---- NAME RELEVANCE GATE ----
    const { sharedDistinct, coverageMin, qCoreCount } = nameRelevance(query, title);
    if (sharedDistinct.length === 0 || coverageMin < 0.5) continue;

    // Fetch categories PER-TITLE (MediaWiki's cllimit is a TOTAL across a
    // multi-title response, so batching would starve later pages of buckets).
    const catUrl =
      `${origin}/w/api.php?action=query&prop=categories&cllimit=200&format=json&titles=${encodeURIComponent(title)}`;
    const catData = await wikiFetch(catUrl);
    const page = Object.values(catData?.query?.pages ?? {})[0] as any;
    if (!page || page.missing) continue;

    const catBlob = (page?.categories ?? [])
      .map((c: any) => String(c.title).toLowerCase())
      .join(" ");
    for (const kw of kwList) {
      if (catBlob.includes(kw)) {
        matchedTitle = page.title;
        matchedCat = kw;
        matchedUri = `${origin}/wiki/${encodeURIComponent(page.title)}`;
        confidence = Math.round(coverageMin * 100);
        // Review only when a MULTI-token query is only partially covered by the
        // article's name (i.e. the query might be a different person sharing a
        // token). A single distinctive-token query that matches the surname IS
        // the intended strong match (قذافي -> معمر القذافي).
        needsReview = sharedDistinct.length > 0 && coverageMin < 1 && qCoreCount >= 2;
        break;
      }
    }
    if (matchedTitle) break;
  }

  if (!matchedTitle) return undefined;

  return {
    fullName: query,
    nationality: "Global / International",
    type: "Individual",
    listSource: "Live Online Search (international sanctions / wanted designations)",
    status: "Flagged",
    riskScore: needsReview ? 70 : 90,
    details:
      `فحص آلي مباشر عبر الإنترنت أثناء توفر الاتصال (Live online screening).\n` +
      `السبب: تطابق الاسم "${query}" مع الصفحة: "${matchedTitle}" (نسبة تطابق الاسم ${confidence}%).\n` +
      `التصنيف الدال على عقوبات/ملاحقات/إرهاب: "${matchedCat}".\n` +
      (needsReview
        ? `⚠ تحذير: التطابق الاسمي غير كامل وربما يكون هناك شخص آخر يحمل نفس العناصر الاسمية — يجب التحقق اليدوي من قاعدة بيانات العقوبات الرسمية قبل اتخاذ أي قرار.\n`
        : `\n`) +
      `يجب إكمال العناية الواجبة المشددة (EDD) والتحقق النهائي يدوياً من قاعدة بيانات العقوبات الرسمية (OFAC / UN / EU / CBE).`,
    matchBasis: {
      article: matchedTitle,
      category: matchedCat,
      confidence,
      needsReview,
    },
    sources: [
      { title: `Live cross-reference: Wikipedia “${matchedTitle}”`, uri: matchedUri },
      { title: "US Treasury – OFAC SDN List", uri: "https://sanctionssearch.ofac.treas.gov/" },
      { title: "Interpol Red Notices", uri: "https://www.interpol.int/How-we-work/Notices/Red-notices" },
      { title: "UN Security Council Sanctions (SCSAN)", uri: "https://scsanctions.un.org/" },
      { title: "EU External Action Service – Consolidated Sanctions List", uri: "https://data.europa.eu/en/data-consolidated-eu-sanctions" },
    ],
  };
}
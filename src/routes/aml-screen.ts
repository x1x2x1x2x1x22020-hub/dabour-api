import { Router } from "express";
import { findDirectAmlMatch } from "../lib/dabour-aml-db";
import { screenOnline } from "../lib/aml-online";
import { ensureListsLoaded, searchSanctionsList } from "../lib/aml-lists";
import { checkIntelligentArabicFallback } from "../lib/dabour-helpers";

const router = Router();

router.post("/aml-screen", async (req, res) => {
  const { query, lang = "EN" } = req.body || {};
  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'query' parameter." });
  }
  const amlQuery = query.trim();
  const directMatch = findDirectAmlMatch(amlQuery);

  try {
    if (process.env.OPENAI_API_KEY) {
      const userPrompt = `You are performing a highly precise legal background validation and AML/CFT compliance screen.
Target: "${amlQuery}"

Consult your knowledge regarding:
1. Active terrorism charges, wanted lists, fugitives (FBI Most Wanted, Interpol Red Notices, Egyptian Police listings).
2. Egyptian judicial records and court rulings.
3. Money laundering, public corruption, asset freezes, fraud, tax evasion.
4. PEP (Politically Exposed Person) status.

CRITICAL ANTI-FALSE-POSITIVE DIRECTIVE: Names like Ahmed, Mohamed, Ali are very common. DO NOT flag innocent civilians sharing a name. Only flag if 100% certain this target matches a prominent listed entity. Otherwise return status "Clear" with riskScore 0-5.

Return strict JSON only:
{
  "fullName": string,
  "nationality": string,
  "type": "Individual" | "Entity",
  "status": "Flagged" | "Clear",
  "riskScore": number,
  "listSource": string,
  "details": string
}`;

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        // Bounded: if the model is slow/unreachable we drop into the key-free
        // tiers (local lists -> OFAC/UN -> web lookup -> smart fallback).
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: "You are an elite, highly precise AML compliance screener. Default to Clear (riskScore 0-5) unless there is official sanctions-list proof for this exact target. Output raw JSON only.",
            },
            { role: "user", content: userPrompt },
          ],
        }),
      });
      if (response.ok) {
        const data = await response.json() as any;
        const parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? "{}");
        return res.json({
          success: true,
          isLive: true,
          result: {
            id: `aml-live-${Date.now()}`,
            fullName: parsed.fullName || amlQuery,
            nationality: parsed.nationality || "Unknown/Global",
            type: parsed.type || "Individual",
            listSource: parsed.listSource || "Model Knowledge Base",
            status: parsed.status || "Clear",
            riskScore: parsed.riskScore !== undefined ? parsed.riskScore : 5,
            details: parsed.details || "Screen completed with zero active concerns.",
            sources: [
              {
                title: "Search Verification",
                uri: `https://www.google.com/search?q=${encodeURIComponent(amlQuery + " aml sanctions")}`,
              },
            ],
          },
        });
      }
    }
    throw new Error("No AI configured");
  } catch {
    if (directMatch) {
      return res.json({
        success: true,
        isLive: false,
        isFallback: true,
        result: { id: `aml-fallback-${Date.now()}`, ...directMatch },
      });
    }

    // -------------------------------------------
    // AUTHORITATIVE SANCTIONS LISTS (OFAC SDN + UN Consolidated, no API key).
    // The background loader is kicked off but NEVER awaited here, so this tier
    // costs nothing when the lists are not cached yet: searchSanctionsList()
    // simply returns [] and the pipeline continues with the live/web tiers.
    // -------------------------------------------
    try {
      ensureListsLoaded();
      const listHits = searchSanctionsList(amlQuery, 1);
      if (listHits.length > 0) {
        const hit = listHits[0];
        const reviewNote = hit.needsReview
          ? (lang === "AR"
            ? " — التطابق الاسمي غير كامل، يجب التحقق اليدوي من قاعدة بيانات العقوبات الرسمية قبل اتخاذ أي قرار."
            : " — name match is partial, verify manually against the official sanctions database before any decision.")
          : "";
        return res.json({
          success: true,
          isLive: false,
          isOnline: false,
          isFallback: false,
          isAuthoritative: true,
          result: {
            id: `aml-authoritative-${Date.now()}`,
            fullName: `${hit.fullName} (${amlQuery})`,
            nationality: "Global / International",
            type: hit.type,
            listSource:
              hit.list === "UN Consolidated"
                ? `UN Security Council Consolidated List (${(hit.programs || []).join(", ") || "UN"})`
                : `US OFAC SDN List (${(hit.programs || []).join(", ") || "OFAC"})`,
            status: "Flagged",
            riskScore: hit.needsReview ? 70 : 90,
            details:
              (lang === "AR"
                ? `تطابق الاسم "${amlQuery}" مع الإدراج الرسمي "${hit.fullName}" (نسبة التطابق ${hit.confidence}%). البرامج/المرجع: ${(hit.programs || []).join(", ") || hit.reference || hit.list}.${reviewNote} يجب إكمال العناية الواجبة المشددة (EDD).`
                : `Name "${amlQuery}" matched the official listing "${hit.fullName}" (confidence ${hit.confidence}%). Programs/reference: ${(hit.programs || []).join(", ") || hit.reference || hit.list}.${reviewNote} Complete enhanced due diligence (EDD).`),
            sources: [{ title: hit.list, uri: hit.uri }],
            confidence: hit.confidence ?? 0,
            needsReview: hit.needsReview ?? false,
          },
        });
      }
    } catch {
      // ignore -> treat as no lists match
    }

    // -------------------------------------------
    // AUTOMATIC ONLINE SEARCH (no API key needed).
    // Runs whenever the device is online and the name isn't already in the
    // local hard-coded list, so arbitrary names are screened/looked-up live.
    // Offline or network failure returns undefined -> we fall back below.
    // -------------------------------------------
    try {
      const online = await screenOnline(amlQuery);
      if (online) {
        return res.json({
          success: true,
          isLive: true,
          isOnline: true,
          isFallback: false,
          result: {
            id: `aml-online-${Date.now()}`,
            fullName: online.fullName,
            nationality: online.nationality,
            type: online.type,
            listSource: online.listSource,
            status: online.status,
            riskScore: online.riskScore,
            details: online.details,
            sources: online.sources,
            matchBasis: online.matchBasis,
            confidence: online.matchBasis?.confidence ?? 0,
            needsReview: online.matchBasis?.needsReview ?? false,
          },
        });
      }
    } catch {
      // ignore -> treat as no online match
    }

    // LAST RESORT: screening must NEVER fail with a 500 — the auditor always
    // gets an answer they can act on (with an explicit re-check instruction).
    let result: ReturnType<typeof checkIntelligentArabicFallback>;
    try {
      result = checkIntelligentArabicFallback(amlQuery, lang);
    } catch {
      result = {
        fullName: amlQuery,
        nationality: lang === "AR" ? "غير محدد" : "Unknown / Not determined",
        type: "Individual",
        listSource: lang === "AR" ? "يحتاج تحقق يدوي" : "Manual re-check required",
        status: "Under Review",
        riskScore: 40,
        details:
          lang === "AR"
            ? "تعذر إتمام الفحص آلياً في هذه اللحظة. الاسم محفوظ كفحص معلق ويجب إعادة فحصه يدوياً ضد قوائم الضبط: OFAC SDN، القائمة الموحدة للأمم المتحدة، الإنذارات الحمراء للانتربول، وقوائم الشرطة المصرية والنائب العام."
            : "Automatic screening could not complete right now. The name is recorded as a PENDING check and must be re-screened manually against OFAC SDN, the UN Consolidated List, Interpol Red Notices and Egyptian police/prosecution lists.",
        sources: [
          { title: "US Treasury – OFAC SDN List", uri: "https://sanctionssearch.ofac.treas.gov/" },
          { title: "UN Security Council – Consolidated List", uri: "https://scsanctions.un.org/" },
          { title: "Interpol – Red Notices", uri: "https://www.interpol.int/How-we-work/Notices/Red-notices" },
        ],
      } as ReturnType<typeof checkIntelligentArabicFallback>;
    }
    return res.json({
      success: true,
      isLive: false,
      isFallback: true,
      result: { id: `aml-dynamic-fallback-${Date.now()}`, ...result },
    });
  }
});

export default router;

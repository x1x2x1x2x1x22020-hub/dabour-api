import { Router } from "express";
import { getPlaceholderResponse } from "../lib/dabour-helpers";

const router = Router();

const SYSTEM_PROMPT =
  "You are Sami, an elite, professional AI Audit Copilot integrated inside 'Dabour Audit App'. You provide expert guidance matching International Standards on Auditing (ISA) and International Standards on Quality Management (ISQM). Generate high-quality, professional markdown responses. Keep the tone authoritative, helpful, precise, and practical.";

function buildPrompt(tool: string, params: any): string | null {
  if (tool === "generate-procedures") {
    const {
      industry = "General Manufacturing",
      auditArea = "Revenue",
      complianceStandard = "ISA 315",
    } = params || {};
    return `Please generate an extensive, highly professional, and tailored Audit Program Procedure Checklist for the audit area of '${auditArea}' for a client operating in the '${industry}' industry, ensuring full compliance with ${complianceStandard}.
Provide:
1. A brief area introduction and regulatory background mapping to ${complianceStandard}.
2. At least 5 specific, high-quality substantive audit procedures.
3. The specific financial statement assertion mapped to each procedure.
4. The required audit evidence/documentation for each procedure.
Format your response in sleek, formatted markdown with bullet points and clear headings.`;
  }
  if (tool === "analyze-financials") {
    const { statementText = "" } = params || {};
    return `You are tasked with executing an analytical review on the following financial statement excerpt or summary record:
"${statementText}"

Please provide:
1. A summary table or breakdown of key account balances and trends observed.
2. Identification of 3-4 potential anomalies, high-risk flags, or unusual transactions under ISA 315.
3. Analytical review comments on materiality benchmarks.
4. 3 structured recommended audit procedures to address these risks.
Format your response in sleek, clear markdown tables and lists.`;
  }
  if (tool === "extract-risks") {
    const { textExcerpt = "" } = params || {};
    return `You are a legal and risk auditing expert. Review the following text snippet or lease/contract excerpt to identify hidden financial and compliance risks under ISA 315:
"${textExcerpt}"

Please provide:
1. Structured list of 3 key risks extracted from this text.
2. For each risk, state Risk Name & Severity, Key FS Assertion affected, the auditing impact, and a concrete test procedure.
Format in beautiful markdown with rich detail.`;
  }
  if (tool === "create-workpaper") {
    const {
      prepTitle = "Cash in Bank Reconciliation",
      auditorName = "Senior Auditor",
      objective = "Verify the accuracy and existence of cash balance limits",
    } = params || {};
    return `You are a certified senior manager drafting an audit workpaper template.
Workpaper Title: ${prepTitle}
Prepared By: ${auditorName}
Objective: ${objective}

Please draft a professionally structured markdown workpaper skeleton with:
1. Workpaper Header Metadata Block (Client Name, Period End, Title, Prepared By, Reviewed By, Date).
2. Audit Objective & Testing Strategy statement.
3. A markdown table representing the workpaper test grid with columns: Audit Step, Sample Ref, Bank Balance, Ledger Balance, Variance, Explanation, Performed By, Work Done Code.
4. Concluding audit opinion declaration structure.
Deliver in clean markdown.`;
  }
  return null;
}

router.post("/sami-copilot", async (req, res) => {
  const { tool, params } = req.body || {};
  if (!tool) {
    return res.status(400).json({ error: "Missing 'tool' parameter." });
  }
  const userPrompt = buildPrompt(tool, params);
  if (!userPrompt) {
    return res.status(400).json({ error: `Unsupported tool '${tool}'.` });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (apiKey && process.env.OPENAI_API_KEY) {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.2,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
        }),
      });
      if (response.ok) {
        const data = await response.json() as any;
        const text = data?.choices?.[0]?.message?.content ?? "";
        return res.json({ success: true, text, isSimulated: false });
      }
    }
    throw new Error("No AI configured");
  } catch {
    return res.json({
      success: true,
      text: getPlaceholderResponse(tool, params, true),
      isSimulated: true,
    });
  }
});

export default router;

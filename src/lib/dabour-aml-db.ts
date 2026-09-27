// Local AML lookup database & matcher extracted from the original Express server.
export interface AmlEntry {
  fullName: string;
  nationality: string;
  type: "Individual" | "Entity";
  listSource: string;
  status: "Flagged" | "Clear";
  riskScore: number;
  details: string;
  sources: { title: string; uri: string }[];
}

export const localAmlDb: AmlEntry[] = [
  {
    fullName: "محمد مرسي عيسى العياط (Mohamed Morsi)",
    nationality: "Egypt",
    type: "Individual",
    listSource: "Egyptian Terrorist List / PEP",
    status: "Flagged",
    riskScore: 98,
    details:
      "مدرج رسمياً على قوائم الإرهاب بجمهورية مصر العربية بموجب أحكام محكمة الجنايات والنائب العام (قانون الكيانات الإرهابية رقم ٨ لسنة ٢٠١٥). رئيس جمهورية سابق - مصنف كشخص معرض سياسياً عالي المخاطر (High-Risk PEP) مع توجيهات بالتحفظ على الأموال وتجميد الأصول المصرفية.",
    sources: [
      { title: "الجريدة الرسمية المصرية - قرارات الإدراج والتحفظ", uri: "https://www.cc.gov.eg/" },
      { title: "وحدة مكافحة غسيل الأموال بالبنك المركزي المصري", uri: "https://www.cbe.org.eg/" },
    ],
  },
  {
    fullName: "هشام أحمد فؤاد جنينة (Hisham Geneina)",
    nationality: "Egypt",
    type: "Individual",
    listSource: "PEP Database / Judicial Inquiries",
    status: "Flagged",
    riskScore: 85,
    details:
      "رئيس الجهاز المركزي للمحاسبات الأسبق بمصر. مصنف شخص معرض سياسياً (PEP Profile) عالي المخاطر مرتبط بقضايا وتحقيقات قضائية سابقة وإدراج للمتابعة والتدقيق المالي المشدد بموجب تعليمات وحدة مكافحة غسيل الأموال بالبنك المركزي.",
    sources: [
      { title: "أحكام وقرارات قضائية - النيابة العامة المصرية", uri: "https://www.ppo.gov.eg/" },
      { title: "الجهاز المركزي للمحاسبات - تقارير الحوكمة والامتثال", uri: "https://www.cbe.org.eg/" },
    ],
  },
  {
    fullName: "Sami Al-Dabour",
    nationality: "Jordan",
    type: "Individual",
    listSource: "PEP Database",
    status: "Flagged",
    riskScore: 78,
    details:
      "Politically Exposed Person (PEP) profile identified. Mapped as a senior regulatory advisor on industrial concession approvals. Requiring enhanced due diligence (EDD) protocols.",
    sources: [{ title: "Dabour Audit AML Watchlist", uri: "https://www.cbe.org.eg/" }],
  },
  {
    fullName: "أحمد عبد الحميد الدجوي (Ahmed Abdel Hamid El-Dejwy)",
    nationality: "Egypt",
    type: "Individual",
    listSource: "UN Sanctions",
    status: "Flagged",
    riskScore: 95,
    details:
      "قوائم الكيانات الإرهابية بقرار محكمة الجنايات والنائب العام بجمهورية مصر العربية. Flagged under Egyptian Terrorist Entities Law 8/2015 with immediate asset freeze directive.",
    sources: [{ title: "Egyptian Judicial Gazettes", uri: "https://www.cc.gov.eg/" }],
  },
  {
    fullName: "السيد علي خامنئي (Ali Khamenei)",
    nationality: "Iran",
    type: "Individual",
    listSource: "US OFAC / EU Consolidated / UN Iran Sanctions",
    status: "Flagged",
    riskScore: 100,
    details:
      "المرشد الأعلى لإيران والقائد العام للقوات المسلحة ورئيس مجلس صيانة الدستور. مصنّف على قائمة العقوبات الأمريكية (OFAC – Specially Designated Nationals) بموجب الأمر التنفيذي 13224 والقانون CAATSA (13846)، ومدرج على قائمة العقوبات الأوروبية، وتخضع إيران لعقوبات مجلس الأمن المرتبطة بالبرنامج النووي (القرار 2231). يترتب على الإدراج تجميد الأصول وحظر التعامل ومنع منح التأشيرات.",
    sources: [
      { title: "US Treasury – OFAC SDN List", uri: "https://sanctionssearch.ofac.treas.gov/" },
      { title: "UN Security Council – Resolution 2231 (Iran)", uri: "https://scsanctions.un.org/" },
      { title: "EU Sanctions Map – Iran", uri: "https://www.sanctionsmap.eu/" },
      { title: "Central Bank of Egypt – AML/CFT Unit", uri: "https://www.cbe.org.eg/" },
    ],
  },
  {
    fullName: "صدام حسين (Saddam Hussein)",
    nationality: "Iraq",
    type: "Individual",
    listSource: "UN Security Council Sanctions (Iraq) – Historical Listing",
    status: "Flagged",
    riskScore: 99,
    details:
      "رئيس العراق السابق (1979–2003). أُدرج تاريخياً على قوائم العقوبات الأممية الخاصة بالعراق (قرارات مجلس الأمن 661 و1284 و1483) مع تجميد الأصول وحظر التعامل ومنع تصدير النفط، وأُدرجت كيانات مرتبطة به على قائمة العقوبات الأمريكية OFAC. الإدراج لم يعد سارياً بعد 2003، لكنه يستوجب العناية الواجبة المشددة عند ظهور أي تعامل مرتبط بالأشخاص أو الكيانات المدرجة تاريخياً.",
    sources: [
      { title: "UN Security Council – Iraq Sanctions (Res. 661/1284/1483)", uri: "https://scsanctions.un.org/" },
      { title: "US Treasury – OFAC SDN List (archived Iraq designations)", uri: "https://sanctionssearch.ofac.treas.gov/" },
    ],
  },
  {
    fullName: "أسامة بن لادن (Osama bin Laden)",
    nationality: "Saudi Arabia / Global",
    type: "Individual",
    listSource: "US OFAC SDN / UN 1267 Committee / FBI Most Wanted",
    status: "Flagged",
    riskScore: 100,
    details:
      "زعيم تنظيم القاعدة. مدرج باسمه الصريح على قائمة العقوبات الأمريكية OFAC (Specially Designated National – SDN) وعلى قائمة لجنة عقوبات مجلس الأمن (1267/1989) الخاصة بالقاعدة وطالبان وداعش بموجب القرارات 1267 و1333 و1989. يشمل الإدراج تجميد الأصول وحظر التعامل ومنع توفير التمويل أو الملاذ أو التدريب، وهو مطلوب دولياً.",
    sources: [
      { title: "US Treasury – OFAC SDN List", uri: "https://sanctionssearch.ofac.treas.gov/" },
      { title: "UN Security Council – ISIL/Al-Qaida/Taliban Sanctions (Res. 1267/1989)", uri: "https://scsanctions.un.org/" },
      { title: "FBI Most Wanted – Terrorism", uri: "https://www.fbi.gov/wanted" },
    ],
  },
  {
    fullName: "شركة الدلتا للاستيراد وتجارة المعادن (Delta Steel Import & Trading)",
    nationality: "Egypt",
    type: "Entity",
    listSource: "EU Consolidated List",
    status: "Flagged",
    riskScore: 88,
    details:
      "مدرج بلائحة الحظر الأمني للهيئة العامة للرقابة المالية بمصر (FRA Suspect List). Associated with active investigations regarding Trade-Based Money Laundering (TBML).",
    sources: [{ title: "Financial Regulatory Authority FRA Egypt", uri: "http://www.fra.gov.eg" }],
  },
  {
    fullName: "البنك المتحد للائتمان الأجنبي (United Foreign Credit Shell)",
    nationality: "Egypt / Seychelles",
    type: "Entity",
    listSource: "OFAC Watchlist",
    status: "Flagged",
    riskScore: 94,
    details:
      "Correspondent shell financial institution suspected of processing restricted offshore wires without adequate KYC credentials.",
    sources: [{ title: "Central Bank of Egypt AML Portal", uri: "https://www.cbe.org.eg/" }],
  },
  {
    fullName: "شركة السويدي القابضة للمقاولات (Elsewedy Contracting Hub)",
    nationality: "Egypt",
    type: "Entity",
    listSource: "None",
    status: "Clear",
    riskScore: 8,
    details:
      "Egyptian Corporate Register verified. Zero matching records across Central Bank of Egypt AML unit, military procurement blacklists, and FRA warning watchlists.",
    sources: [{ title: "Egyptian commercial register", uri: "http://www.moit.gov.eg/" }],
  },
];

export function findDirectAmlMatch(query: string): AmlEntry | undefined {
  const queryNorm = query.toLowerCase().trim();
  return localAmlDb.find((entry) => {
    const cleanName = entry.fullName.toLowerCase().replace(/\s*\(.*?\)\s*/g, "").trim();
    if (cleanName === queryNorm || queryNorm === entry.fullName.toLowerCase()) return true;
    const parentheticalMatch = entry.fullName.toLowerCase().match(/\(([^)]+)\)/);
    if (parentheticalMatch && parentheticalMatch[1].trim() === queryNorm) return true;

    if (entry.fullName.includes("مرسي") || entry.fullName.includes("Morsi")) {
      const hasMorsi = queryNorm.includes("مرسي") || queryNorm.includes("morsi") || queryNorm.includes("mursi");
      const hasMohamed =
        queryNorm.includes("محمد") || queryNorm.includes("mohamed") || queryNorm.includes("mouhamed");
      return hasMorsi && hasMohamed;
    }
    if (entry.fullName.includes("جنينة") || entry.fullName.includes("Geneina")) {
      const hasGeneina = queryNorm.includes("جنينة") || queryNorm.includes("geneina") || queryNorm.includes("genena");
      const hasHisham = queryNorm.includes("هشام") || queryNorm.includes("hisham");
      return hasGeneina && hasHisham;
    }
    if (entry.fullName.includes("الدجوي") || entry.fullName.includes("Dejwy")) {
      const hasDejwy = queryNorm.includes("الدجوي") || queryNorm.includes("dejwy") || queryNorm.includes("deghwy");
      const hasAhmed = queryNorm.includes("أحمد") || queryNorm.includes("احمد") || queryNorm.includes("ahmed");
      return hasDejwy && (queryNorm.length > 5 || hasAhmed);
    }
    if (entry.fullName.includes("Dabour") || entry.fullName.includes("Sami")) {
      const hasDabour = queryNorm.includes("dabour") || queryNorm.includes("دبور");
      const hasSami = queryNorm.includes("sami") || queryNorm.includes("سامي");
      return hasDabour && hasSami;
    }
    if (entry.fullName.includes("الدلتا للاستيراد") || entry.fullName.includes("Delta Steel")) {
      return queryNorm.includes("delta steel") || (queryNorm.includes("الدلتا") && queryNorm.includes("استيراد"));
    }
    if (entry.fullName.includes("خامنئي") || entry.fullName.includes("Khamenei")) {
      // Titles like "آية الله" / "supreme leader" are shared by many clerics, so
      // only the distinctive surname itself is accepted as evidence here.
      return queryNorm.includes("خامنئي") || queryNorm.includes("khamenei");
    }
    if (entry.fullName.includes("بن لادن") || entry.fullName.includes("bin laden")) {
      return (
        queryNorm.includes("بن لادن") ||
        queryNorm.includes("بنلادن") ||
        queryNorm.includes("bin laden") ||
        queryNorm.includes("binladen")
      );
    }
    if (entry.fullName.includes("صدام") || entry.fullName.includes("saddam")) {
      // "حسين" is one of the most common given names in the region and must not
      // flag on its own — the distinctive token is صدام / saddam.
      return queryNorm.includes("صدام") || queryNorm.includes("saddam");
    }
    if (entry.fullName.includes("المتحد للائتمان") || entry.fullName.includes("United Foreign Credit")) {
      return queryNorm.includes("united foreign") || (queryNorm.includes("المتحد") && queryNorm.includes("ائتمان"));
    }
    return false;
  });
}

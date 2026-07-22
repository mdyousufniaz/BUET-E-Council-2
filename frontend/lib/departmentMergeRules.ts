// Mirrors the rule set documented in MERGE_RULES.md — that file is the source
// of truth; keep this table in sync with it. Rules are matched in order
// against the raw department string; the first match wins.
//
// JS `\b` is ASCII-only and never matches after Bangla characters (unlike Python's
// Unicode-aware `\b`), so the two rules that relied on it (#24, #26) use an explicit
// "next char isn't Bangla, or end of string" lookahead instead.
const NOT_BANGLA_OR_END = "(?=$|[^ঀ-৿])";

interface MergeRule {
  pattern: RegExp;
  target: string;
}

export const DEPARTMENT_MERGE_RULES: MergeRule[] = [
  { pattern: /তড়িৎ|ইলেক/, target: "Electrical and Electronic Engineering" },
  { pattern: /কম্পিউটার/, target: "Computer Science and Engineering" },
  { pattern: /ইন্ডাষ্ট্রিয়াল|ইন্ড্রাষ্ট্রিয়াল|আই[,.\s]*পি[,.\s]*ই/, target: "Industrial and Production Engineering" },
  { pattern: /এপ্রোপ্রিয়েট|এ্যপ্রোপ্রিয়েট|আই[,.\s]*এ[,.\s]*টি/, target: "Institute of Appropriate Technology" },
  { pattern: /ইনফরমেশন এন্ড কমিউনিকেশন|আই[,.\s]*আই[,.\s]*সি[,.\s]*টি/, target: "Institute of Information and Communication Technology" },
  { pattern: /বন্যা|আই[,.\s]*এফ[,.\s]*সি[,.\s]*ডি[,.\s]*আর|আই[,.\s]*ডব্লিউ[,.\s]*এফ[,.\s]*এম/, target: "Institute of Water and Flood Management" },
  { pattern: /পেট্রোলিয়াম|মিনারেল/, target: "Petroleum and Mineral Resources Engineering" },
  { pattern: /ধাতব|মেটালার্জিক্যাল/, target: "Materials and Metallurgical Engineering" },
  { pattern: /^গনিত বিভাগ$|^গণিত বিভাগ$/, target: "Mathematics" },
  { pattern: /পদার্থ/, target: "Physics" },
  { pattern: /ফিজিকস বিভাগ/, target: "Physics" },
  { pattern: /গ্লাস এন্ড সিরামিক/, target: "Nanomaterials and Ceramic Engineering" },
  { pattern: /যন্ত্র?কৌশল (অনুষদ|বিভাগ)$|যন্ত্রিকৌশল/, target: "Mechanical Engineering" },
  { pattern: /নৌ|জলযান/, target: "Naval Architecture and Marine Engineering" },
  { pattern: /আর্কিটেকচার|অস্থাপত্য|স্হাপত্য বিভাগ$|স্থাপত্য কৌশল বিভাগ|^স্থাপত্য বিভাগ$|^স্থাপত্য অনুষদ$/, target: "Architecture" },
  { pattern: /স্থাপত্য ও পরিকল্পনা|স্হাপত্য ও পরিকল্পনা/, target: "Architecture" },
  { pattern: /নগর ও (অঞ্চল )?পরিকল্পনা|^পরিকল্পনা বিভাগ$|আই[,.\s]*উ[,.\s]*আর[,.\s]*পি|ইউ[,.\s]*আর[,.\s]*পি/, target: "Urban and Regional Planning" },
  { pattern: /পানিসম্পদ|পানি সম্পদ/, target: "Water Resources Engineering" },
  { pattern: /কেমিকেল ইনজিনিয়ারিং|^কেমিকৌশল(\s+বিজ্ঞান)?/, target: "Chemical Engineering" },
  { pattern: /সিভিল ইনজিনিয়ারিং|^পুরকৌশল (বিভাগ|বিভা|অনুষদ)|^প্রকৌশল অনুষদ$/, target: "Civil Engineering" },
  { pattern: /কেমিষ্ট্রি বিভাগ|^রসায়ন বিভাগ$/, target: "Chemistry" },
  { pattern: /^মানবিক বিভাগ$/, target: "Humanities" },
  { pattern: /ইলেকট্রিক্যাল ইনজিনিয়ারিং/, target: "Electrical and Electronic Engineering" },
  { pattern: new RegExp(`^সি[.,\\s]*এস[.,\\s]*ই${NOT_BANGLA_OR_END}`), target: "Computer Science and Engineering" },
  { pattern: /^ত[.,\s]*ই[.,\s]*,?\s*কৌশল/, target: "Electrical and Electronic Engineering" },
  { pattern: new RegExp(`^পি[.,\\s]*এম[.,\\s]*আর[.,\\s]*ই${NOT_BANGLA_OR_END}`), target: "Petroleum and Mineral Resources Engineering" },
  { pattern: /^যন্ত্রকৌশল বিভাগ বাপ্রবি/, target: "Mechanical Engineering" },
  { pattern: /বায়োমেডিক্যাল|বায়োমেডিকেল/, target: "Biomedical Engineering" },
  { pattern: new RegExp(`^সি[.,\\s]*ই[.,\\s]*ই${NOT_BANGLA_OR_END}`), target: "Civil Engineering" },
];

/**
 * Resolves a raw (unmatched) department string to a department id using the
 * MERGE_RULES.md regex table. Returns null if no rule matches, or if the
 * matching rule's target department isn't present in the given department list.
 */
export function resolveDepartmentByMergeRule(
  rawName: string,
  departments: Array<{ id: string; name_english?: string }>
): string | null {
  const rule = DEPARTMENT_MERGE_RULES.find((r) => r.pattern.test(rawName));
  if (!rule) return null;

  const target = departments.find(
    (d) => d.name_english?.toLowerCase() === rule.target.toLowerCase()
  );
  return target ? target.id : null;
}

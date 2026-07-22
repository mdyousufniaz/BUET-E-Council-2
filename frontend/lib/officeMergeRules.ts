// Mirrors departmentMergeRules.ts, but for the `office` free-text field on
// imported presentees. Unlike departments (which cover ~27 fairly distinct
// legacy spellings), office text mostly varies only for the two university-wide
// leadership posts (Vice Chancellor / Pro-Vice Chancellor) — e.g. legacy JSON
// exports often say "উপাচার্য ও সভাপতি" (Vice Chancellor AND Chairman) instead
// of the canonical "উপাচার্য" office row, so an exact string match silently
// fails and the VC gets dropped into manual/unresolved resolution.
//
// Per-faculty Dean / per-department Head offices are intentionally NOT covered
// here: a wrong guess there would misattribute someone to the wrong faculty or
// department, which is worse than asking a human to resolve it once. The VC and
// Pro-VC posts are university-wide singletons, so a false match isn't possible.
interface MergeRule {
  pattern: RegExp;
  target: string;
}

export const OFFICE_MERGE_RULES: MergeRule[] = [
  // Order matters: Pro-VC must be checked first since "উপাচার্য" is a substring
  // of "উপ-উপাচার্য"/"উপউপাচার্য".
  { pattern: /উপ-?উপাচার্য/, target: "উপ-উপাচার্য, বাংলাদেশ প্রকৌশল বিশ্ববিদ্যালয়" },
  { pattern: /উপাচার্য/, target: "উপাচার্য, বাংলাদেশ প্রকৌশল বিশ্ববিদ্যালয়" },
];

/**
 * Resolves a raw (unmatched) office string to an office id using the rules
 * above. Returns null if no rule matches, or if the matching rule's target
 * office isn't present in the given office list.
 */
export function resolveOfficeByMergeRule(
  rawName: string,
  offices: Array<{ id: string; name_bangla?: string }>
): string | null {
  const rule = OFFICE_MERGE_RULES.find((r) => r.pattern.test(rawName));
  if (!rule) return null;

  const target = offices.find(
    (o) => o.name_bangla?.toLowerCase() === rule.target.toLowerCase()
  );
  return target ? target.id : null;
}

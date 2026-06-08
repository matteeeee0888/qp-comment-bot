// lib/classify.js
// Cat is checked first because "CCL_CAT" also contains the dog-matching "CCL".
export function classifyTopic(campaignName = "") {
  const s = String(campaignName == null ? "" : campaignName).toUpperCase();
  if (s.includes("CCL_CAT") || /(^|[^A-Z])CAT([^A-Z]|$)/.test(s)) return "cat";
  if (/CCL_DOG|CCLDOG|LWF|CALMICOLLAR|CCL|DOG/.test(s)) return "dog";
  return null;
}

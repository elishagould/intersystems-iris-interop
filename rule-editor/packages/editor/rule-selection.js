export function resolveBusinessRuleName(value, names) {
  const query = String(value ?? "").trim().toLowerCase();
  if (!query) return null;
  return names.find(name => name.toLowerCase() === query) ?? null;
}
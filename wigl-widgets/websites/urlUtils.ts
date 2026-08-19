// Pure URL-normalization logic, kept separate from index.tsx so it can be
// unit-tested without rendering React (see docs/testing.md).

// A bare domain typed into the address bar ("example.com") has no scheme,
// so the browser would resolve it relative to the app itself rather than
// navigating the iframe — prepend https:// whenever one isn't already
// present. Anything with an existing `scheme://` (http, https, file, a
// custom app scheme, ...) is left untouched.
const HAS_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

export const normalizeUrl = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed) return "";
  return HAS_SCHEME_RE.test(trimmed) ? trimmed : `https://${trimmed}`;
};

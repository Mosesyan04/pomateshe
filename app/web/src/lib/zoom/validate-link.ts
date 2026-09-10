/**
 * docs/ZOOM.md §1: MVP validation is format-only — there's no Zoom API access in this
 * scenario (and no need for one, per that doc's own reasoning), so this can't and doesn't
 * confirm the link is a real, working meeting room. It only rejects things that plainly
 * aren't a Zoom link at all.
 */
export function isValidZoomUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" && /(^|\.)zoom\.us$/i.test(url.hostname);
}

/**
 * Shared across /teacher/schedule, /teacher/dashboard, /student/schedule — anywhere a lesson
 * row is rendered. Renders nothing when the lesson has no zoomLinkSnapshot (teacher never set
 * a personal link, or set one after this particular lesson was already created — snapshots
 * aren't retroactive, docs/ZOOM.md §1).
 */
export function ZoomJoinLink({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      Подключиться
    </a>
  );
}

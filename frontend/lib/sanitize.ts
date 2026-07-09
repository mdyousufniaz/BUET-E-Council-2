import DOMPurify from "dompurify";

// Agenda/resolution/meeting content and templates are stored as rich-text
// HTML that moderators can edit, then rendered via dangerouslySetInnerHTML
// for other users (including admins) to view. Sanitize before render so a
// moderator can't smuggle a script into a viewer's or admin's session.
export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return "";
  return DOMPurify.sanitize(html);
}

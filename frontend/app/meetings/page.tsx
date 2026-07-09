import { redirect } from "next/navigation";

// The public meetings list actually lives at "/" (see app/page.tsx); this
// exists only so a natural guess at "/meetings" doesn't dead-end in a 404.
export default function MeetingsIndexPage() {
  redirect("/");
}

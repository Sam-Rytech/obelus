import Link from "next/link";

export default function NotFound() {
  return (
    <div className="wrap narrow empty-page">
      <h1 className="page-title">Nothing here</h1>
      <p className="page-sub">
        That page or report doesn&rsquo;t exist. Report links look like <code>/r/</code> followed by ten characters.
      </p>
      <p className="page-actions">
        <Link href="/check" className="button">
          Check an announcement
        </Link>
        <Link href="/examples" className="button button-quiet">
          See examples
        </Link>
      </p>
    </div>
  );
}

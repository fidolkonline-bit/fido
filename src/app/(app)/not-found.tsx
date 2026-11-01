import Link from "next/link";

export default function NotFound() {
  return (
    <div className="stack">
      <div className="pagehead"><h1>Record not found</h1></div>
      <p className="muted">It may have been removed from your permitted locations, or the link is wrong.</p>
      <div><Link className="btn" href="/">Back to home</Link></div>
    </div>
  );
}

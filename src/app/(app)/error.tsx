"use client";

export default function ErrorState({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const denied = error.message.includes("permission");
  return (
    <div className="stack" style={{ maxWidth: 560 }}>
      <div className="pagehead"><h1>{denied ? "Not available for your role" : "Something went wrong"}</h1></div>
      <p className="note note-err">{denied ? error.message : "This page could not be loaded. Nothing was saved by this error."}</p>
      {!denied && <div><button className="btn" onClick={reset}>Try again</button></div>}
    </div>
  );
}

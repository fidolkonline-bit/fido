import Link from "next/link";
import type { ReactNode } from "react";

export function PageHead({ eyebrow, title, actions }: { eyebrow?: string; title: string; actions?: ReactNode }) {
  return (
    <div className="pagehead">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export type Column<T> = {
  label: string;
  render: (row: T) => ReactNode;
  num?: boolean;
  primary?: boolean; // card title on phones
};

// Dense table on desktop; becomes labelled cards on phones (spec §23: no tiny-font workaround).
export function DataTable<T>({ columns, rows, rowKey, empty = "Nothing here yet.", footer, cards = true }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  footer?: ReactNode;
  cards?: boolean;
}) {
  if (!rows.length) return <div className="tablewrap"><div className="empty">{empty}</div></div>;
  return (
    <div className={"tablewrap" + (cards ? " cards" : "")}>
      <table className="dt">
        <thead>
          <tr>{columns.map((c) => <th key={c.label} className={c.num ? "num" : undefined}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)}>
              {columns.map((c) => (
                <td key={c.label} data-label={c.label} className={[c.num ? "num" : "", c.primary ? "primary" : ""].join(" ").trim() || undefined}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
}

export function Badge({ tone = "muted", children }: { tone?: "ok" | "warn" | "err" | "muted"; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function RowLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link className="rowlink" href={href}>{children}</Link>;
}

export function Stat({ label, value, basis }: { label: string; value: ReactNode; basis?: string }) {
  return <div className="stat">{label}<strong>{value}</strong>{basis}</div>;
}

export function Tabs({ items }: { items: { label: string; href: string; active: boolean }[] }) {
  return (
    <nav className="tabs">
      {items.map((i) => <Link key={i.href} href={i.href} aria-current={i.active ? "page" : undefined}>{i.label}</Link>)}
    </nav>
  );
}

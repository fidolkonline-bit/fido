import { money, fmtDate } from "@/lib/money";

export type Day = { day: string; value: string; earning: string };

// Day-by-day breakdown of a daily target: sales and bonus for each day with sales.
export function DaysDetail({ days }: { days: Day[] }) {
  const hit = days.filter((d) => Number(d.earning) > 0);
  return (
    <details className="small">
      <summary className="muted">Bonus on {hit.length} of {days.length} day{days.length === 1 ? "" : "s"} with sales</summary>
      <table className="small" style={{ marginLeft: "auto" }}>
        <tbody>
          {days.map((d) => (
            <tr key={d.day}><td style={{ paddingRight: 8 }}>{fmtDate(new Date(`${d.day}T00:00:00Z`))}</td><td style={{ paddingRight: 8 }}>{money(d.value)}</td><td>{Number(d.earning) > 0 ? money(d.earning) : "—"}</td></tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

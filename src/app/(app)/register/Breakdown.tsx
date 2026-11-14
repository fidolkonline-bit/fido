import type { drawerSummary } from "@/lib/register";
import { money } from "@/lib/money";

type Summary = Awaited<ReturnType<typeof drawerSummary>>;

const method = (m: string) => m.replace("_", " ").toLowerCase();

// Opening + where cash came from − where it went = what the drawer should hold.
export function Breakdown({ s }: { s: Summary }) {
  return (
    <div>
      <div className="totalrow"><span>Opening cash</span><strong>{money(s.opening)}</strong></div>
      {s.inBy.map((r) => <div key={"in" + r.label} className="totalrow"><span>+ {r.label}</span><strong>{money(r.amount)}</strong></div>)}
      {s.outBy.map((r) => <div key={"out" + r.label} className="totalrow"><span>− {r.label}</span><strong>−{money(r.amount)}</strong></div>)}
      <div className="totalrow grand"><span>Cash that should be in the drawer</span><strong>{money(s.expected)}</strong></div>
      {s.nonCash.length > 0 && (
        <p className="small muted">Not in the drawer (card / bank / cheque on sales): {s.nonCash.map((n) => `${method(n.method)} ${money(n.amount)}`).join(" · ")}</p>
      )}
    </div>
  );
}

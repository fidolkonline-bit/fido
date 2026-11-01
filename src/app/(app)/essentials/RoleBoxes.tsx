export function RoleBoxes({ roles, selected = [] }: { roles: string[]; selected?: string[] }) {
  return (
    <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
      <span>Who can see it (none ticked = everyone)</span>
      <div className="row">{roles.map((r) => <label key={r} className="check small"><input type="checkbox" name="audience" value={r} defaultChecked={selected.includes(r)} /> {r}</label>)}</div>
    </fieldset>
  );
}

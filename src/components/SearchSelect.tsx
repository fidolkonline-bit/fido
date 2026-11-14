"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type SearchOption = { id: string; name: string };

// Type-to-filter dropdown that submits the chosen id through a hidden input, so it drops into a plain <form>.
// Matches every word typed, anywhere in the name ("sam gal" finds "Samsung › Galaxy"); best matches first.
export function SearchSelect({ name, options, defaultValue, placeholder = "Search…", noneLabel = "— None —", label }: {
  name: string; options: SearchOption[]; defaultValue?: string | null; placeholder?: string; noneLabel?: string; label: string;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.id === value) ?? null;

  const hits = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return options;
    const scored: { o: SearchOption; s: number }[] = [];
    for (const o of options) {
      const n = o.name.toLowerCase();
      if (!words.every((w) => n.includes(w))) continue;
      const full = q.trim().toLowerCase();
      // Rank: exact, starts with, a word starts with, then anywhere.
      const s = n === full ? 0 : n.startsWith(full) ? 1 : new RegExp(`(^|[\\s›/&-])${escape(words[0])}`).test(n) ? 2 : 3;
      scored.push({ o, s });
    }
    return scored.sort((a, b) => a.s - b.s || a.o.name.localeCompare(b.o.name)).map((x) => x.o);
  }, [q, options]);

  // Row 0 is "None" when nothing is typed; while searching, rows are only the hits.
  const rows: (SearchOption | null)[] = q.trim() ? hits : [null, ...hits];

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) { setOpen(false); setQ(""); } };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = (o: SearchOption | null) => {
    setValue(o?.id ?? "");
    setQ("");
    setOpen(false);
    input.current?.blur();
  };

  const startOpen = () => {
    setOpen(true);
    const i = rows.findIndex((r) => (r?.id ?? "") === value);
    setActive(i < 0 ? 0 : i);
  };

  return (
    <div ref={wrap} className="searchselect">
      <input type="hidden" name={name} value={value} />
      <input
        ref={input}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && rows[active] !== undefined ? `${listId}-${active}` : undefined}
        autoComplete="off"
        value={open ? q : selected?.name ?? ""}
        placeholder={open ? (selected?.name ?? placeholder) : noneLabel}
        onFocus={startOpen}
        onClick={() => { if (!open) startOpen(); }}
        onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); if (!open) startOpen(); else setActive((a) => Math.min(a + 1, rows.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter") { if (open) { e.preventDefault(); if (rows[active] !== undefined) choose(rows[active]); } }
          else if (e.key === "Escape") { if (open) { e.preventDefault(); setOpen(false); setQ(""); } }
          else if (e.key === "Tab") { setOpen(false); setQ(""); }
        }}
      />
      {selected && !open && (
        <button type="button" className="searchselect-clear" aria-label={`Clear ${label}`} onClick={() => choose(null)}>×</button>
      )}
      {open && (
        <div ref={list} id={listId} role="listbox" className="searchselect-list">
          {rows.length === 0 && <div className="searchselect-empty">No match for “{q.trim()}”</div>}
          {rows.map((o, i) => (
            <div
              key={o?.id ?? "__none"}
              id={`${listId}-${i}`}
              data-i={i}
              role="option"
              aria-selected={(o?.id ?? "") === value}
              className={`searchselect-opt${i === active ? " is-active" : ""}${o ? "" : " muted"}`}
              onPointerDown={(e) => e.preventDefault()}
              onPointerEnter={() => setActive(i)}
              onClick={() => choose(o)}
            >
              {o ? <Highlight text={o.name} q={q} /> : noneLabel}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function escape(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function Highlight({ text, q }: { text: string; q: string }) {
  const words = q.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${words.map(escape).join("|")})`, "ig"));
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}</>;
}

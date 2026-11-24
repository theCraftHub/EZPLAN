/**
 * A text box with @mention suggestions that open at the cursor, where the "@" is typed.
 * Arrow keys move through the names, Enter or Tab fills one in, Escape closes the list.
 */
import { forwardRef, useCallback, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from "react";

/** The "@na" being typed just before the cursor, and where its "@" starts. */
export function mentionAt(text: string, cursor: number): { query: string; start: number } | null {
  const m = /(?:^|\s)@([^\s@]{0,30}(?: [^\s@]{0,30})?)$/.exec(text.slice(0, cursor));
  return m ? { query: m[1]!, start: cursor - m[1]!.length - 1 } : null;
}

/** Names that start with what's typed, without the one already typed in full. */
export function mentionMatches(people: string[], query: string, max = 6): string[] {
  const q = query.toLowerCase();
  return people.filter((p) => p.toLowerCase().startsWith(q) && p.toLowerCase() !== q).slice(0, max);
}

const COPY = ["boxSizing", "width", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "whiteSpace", "wordWrap", "overflowWrap", "tabSize"] as const;

/** Pixel position of a character in a textarea, from a hidden copy laid out the same way. */
function caretPoint(box: HTMLTextAreaElement, index: number): { left: number; top: number; line: number } {
  const css = getComputedStyle(box);
  const copy = document.createElement("div");
  for (const k of COPY) copy.style[k] = css[k];
  Object.assign(copy.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre-wrap", overflowWrap: "break-word", top: "0", left: "-9999px" });
  copy.textContent = box.value.slice(0, index);
  const mark = document.createElement("span");
  mark.textContent = "​";
  copy.appendChild(mark);
  document.body.appendChild(copy);
  const point = { left: mark.offsetLeft - box.scrollLeft, top: mark.offsetTop - box.scrollTop, line: parseFloat(css.lineHeight) || parseFloat(css.fontSize) * 1.4 };
  copy.remove();
  return point;
}

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  id: string;
  value: string;
  onValue: (text: string) => void;
  people: string[];
};

export const MentionBox = forwardRef<HTMLTextAreaElement, Props>(function MentionBox({ id, value, onValue, people, className = "", onKeyDown, ...rest }, ref) {
  const box = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => box.current!);
  const listId = useId();
  const [cursor, setCursor] = useState(0);
  const [active, setActive] = useState(0);
  const [closedAt, setClosedAt] = useState<string | null>(null); // Escape closes it until the text changes
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const menu = useRef<HTMLDivElement>(null);

  const typed = mentionAt(value, cursor);
  const names = typed && closedAt !== value ? mentionMatches(people, typed.query) : [];
  const open = names.length > 0;
  const current = Math.min(active, Math.max(names.length - 1, 0));

  useLayoutEffect(() => {
    if (!open || !typed || !box.current) return setPos(null);
    const p = caretPoint(box.current, typed.start);
    const width = box.current.clientWidth;
    setPos({ left: Math.max(0, Math.min(p.left, width - 224)), top: p.top + p.line + 4 });
  }, [open, typed?.start, value]); // eslint-disable-line react-hooks/exhaustive-deps
  // On a phone the list can open below the visible part of a sheet: bring it into view.
  useLayoutEffect(() => { if (open && pos) menu.current?.scrollIntoView?.({ block: "nearest" }); }, [open, pos?.top]); // eslint-disable-line react-hooks/exhaustive-deps

  const track = useCallback(() => setCursor(box.current?.selectionStart ?? 0), []);

  const fill = (name: string) => {
    if (!typed) return;
    const next = `${value.slice(0, typed.start)}@${name} ${value.slice(cursor)}`;
    const at = typed.start + name.length + 2;
    onValue(next);
    setActive(0);
    requestAnimationFrame(() => {
      const el = box.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(at, at);
      setCursor(at);
    });
  };

  return (
    <div className="relative flex flex-col">
      <textarea
        {...rest}
        ref={box}
        id={id}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${current}` : undefined}
        className={className}
        onChange={(e) => { onValue(e.target.value); setCursor(e.target.selectionStart); setActive(0); }}
        onSelect={track}
        onClick={track}
        onKeyUp={(e) => { if (!["ArrowUp", "ArrowDown", "Enter", "Tab", "Escape"].includes(e.key)) track(); }}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setActive((current + (e.key === "ArrowDown" ? 1 : names.length - 1)) % names.length); return; }
            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); fill(names[current]!); return; }
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setClosedAt(value); return; }
          }
          onKeyDown?.(e);
        }}
      />
      {open && (
        <div
          ref={menu}
          id={listId}
          role="listbox"
          aria-label="People to mention"
          className="absolute z-20 flex w-56 flex-col gap-0.5 rounded-xl border border-line bg-surface p-1 shadow-lg"
          style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: "100%" }}
        >
          {names.map((name, i) => (
            <div
              key={name}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === current}
              // Keep focus in the text box while picking with a mouse or finger.
              onMouseDown={(e) => { e.preventDefault(); fill(name); }}
              onMouseEnter={() => setActive(i)}
              className={`flex min-h-11 cursor-pointer items-center rounded-lg px-2.5 text-[15px] font-semibold ${i === current ? "bg-primary-soft text-primary-ink" : "text-ink"}`}
            >
              @{name}
            </div>
          ))}
          <span className="px-2.5 py-1 text-xs text-muted pointer-coarse:hidden">↑ ↓ to choose · Enter to add · Esc to close</span>
        </div>
      )}
    </div>
  );
});

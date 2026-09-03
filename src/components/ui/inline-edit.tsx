import {
  type ComponentPropsWithoutRef,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Check } from "lucide-react";
import { cn } from "@/wigl/utils/index";

/** A label that turns into a text input on click, with a save affordance at
 * its trailing edge — same shape as the other `ui/` components (owned code,
 * `className` passthrough, no prop-per-feature API). `onSave` gets the trimmed
 * value and only fires when it actually changed. Enter or the check button
 * commits; Escape, or focus leaving the control, cancels.
 *
 * Text styling (font, size, weight) is inherited — style the wrapper via
 * `className` and both the static label and the input follow. */
export function InlineEdit({
  value,
  onSave,
  className,
  inputClassName,
  "aria-label": ariaLabel,
  ...rest
}: {
  value: string;
  onSave: (next: string) => void;
  className?: string;
  /** extra classes for the <input> only (e.g. a fixed width) */
  inputClassName?: string;
} & Omit<ComponentPropsWithoutRef<"button">, "value" | "onSave" | "className">) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    setDraft(value);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing, value]);

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== value) onSave(next);
  };
  const cancel = () => {
    setEditing(false);
    setDraft(value);
  };
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        data-no-drag
        aria-label={ariaLabel ?? `Edit: ${value}`}
        onClick={() => setEditing(true)}
        className={cn(
          "cursor-text rounded text-left hover:bg-muted/60 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
          className,
        )}
        {...rest}
      >
        {value}
      </button>
    );
  }

  return (
    <span className={cn("relative inline-flex min-w-0 items-center", className)}>
      <input
        ref={inputRef}
        data-no-drag
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={(e) => {
          if (e.relatedTarget?.getAttribute("data-inline-edit-save") == null) cancel();
        }}
        className={cn(
          "w-full min-w-0 rounded border border-border bg-input/40 py-0.5 pr-7 pl-2 text-inherit outline-hidden",
          inputClassName,
        )}
      />
      <button
        type="button"
        data-no-drag
        data-inline-edit-save
        aria-label="Save"
        onClick={commit}
        className="absolute right-0.5 grid size-5 place-items-center rounded text-muted-foreground hover:text-foreground"
      >
        <Check className="size-3.5" />
      </button>
    </span>
  );
}

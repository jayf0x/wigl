import type { ReactNode } from "react";

export const inputCls =
  "w-full rounded border border-white/10 bg-white/5 px-1 py-0.5 text-[10px] outline-none focus:border-white/30";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[8px] uppercase tracking-widest opacity-30">{label}</span>
      {children}
    </label>
  );
}

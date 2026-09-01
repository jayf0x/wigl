"use client";

import { type ComponentRef, type Ref, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/wigl/utils/index";
import { Input, type InputProps } from "@/components/ui/input";

/** An `<Input type="password">` with an eye / eye-off toggle that flips it to
 * `type="text"`. Same API as `Input` (owned code, `className` passthrough) —
 * `type` is fixed and managed internally. */
export function PasswordInput({
  className,
  ref,
  ...props
}: Omit<InputProps, "type"> & { ref?: Ref<ComponentRef<typeof Input>> }) {
  const [shown, setShown] = useState(false);
  const Icon = shown ? EyeOff : Eye;
  return (
    <span className="relative inline-flex w-full">
      <Input
        ref={ref}
        type={shown ? "text" : "password"}
        className={cn("pr-8", className)}
        {...props}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={shown ? "Hide password" : "Show password"}
        onClick={() => setShown((v) => !v)}
        className="absolute inset-y-0 right-0 z-10 flex w-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
      >
        <Icon className="size-3.5" />
      </button>
    </span>
  );
}

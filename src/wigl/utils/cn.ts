import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merges Tailwind classes, later ones winning on conflicting utilities. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

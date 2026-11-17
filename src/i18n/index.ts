/**
 * Minimal, typed message catalog. English first; add a locale by adding a file with the
 * same shape to ./messages and registering it below.
 */
import en from "./messages/en";

type Messages = typeof en;
type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = Leaves<Messages>;

const catalogs: Record<string, Messages> = { en };
export const DEFAULT_LOCALE = "en";

function lookup(obj: unknown, key: string): string | undefined {
  let cur: unknown = obj;
  for (const part of key.split(".")) {
    if (cur && typeof cur === "object" && part in cur) cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return typeof cur === "string" ? cur : undefined;
}

export type Translator = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function getT(locale: string = DEFAULT_LOCALE): Translator {
  const cat = catalogs[locale] ?? en;
  return (key, vars) => {
    const raw = lookup(cat, key) ?? lookup(en, key) ?? key;
    return vars ? raw.replace(/\{(\w+)\}/g, (_, v: string) => String(vars[v] ?? `{${v}}`)) : raw;
  };
}

export const t = getT();

/** Human label for an enum value, e.g. label("status", "employed_full_time"). */
export function enumLabel(group: keyof Messages["enums"], value: string): string {
  return lookup(en.enums[group], value) ?? value.replace(/_/g, " ");
}

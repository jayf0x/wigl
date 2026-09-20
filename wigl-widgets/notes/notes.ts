export type Note = {
  id: string;
  title: string;
  /** Raw markdown — the editor is the renderer, nothing else is stored. */
  body: string;
  /** ms since epoch */
  updated: number;
};

export const STORAGE = { notes: "notes", active: "active", sidebar: "sidebar" } as const;

export const newNote = (title = "Untitled", body = ""): Note => ({
  id: crypto.randomUUID(),
  title,
  body,
  updated: Date.now(),
});

/** "X copy", then "X copy 2", … — titles aren't keys (ids are), this is just so
 * the sidebar never shows two indistinguishable rows. */
export const copyNote = (n: Note, all: Note[]): Note => {
  const taken = new Set(all.map((x) => x.title));
  let title = `${n.title} copy`;
  for (let i = 2; taken.has(title); i++) title = `${n.title} copy ${i}`;
  return newNote(title, n.body);
};

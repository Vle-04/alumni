"use client";
import { useState } from "react";
import { Button, Input, Select } from "./ui";

/** Editable list of skills with a self-rated level. Submits as a JSON hidden field named `skills`. */
export function SkillsEditor({ initial, error, legend = "Skills (self-rated 1–5)" }: { initial?: { name: string; level: number }[]; error?: string[]; legend?: string }) {
  const [skills, setSkills] = useState(initial?.length ? initial : [{ name: "", level: 3 }]);
  const set = (i: number, patch: Partial<{ name: string; level: number }>) => setSkills(skills.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <fieldset>
      <legend className="mb-2 text-base font-semibold">{legend}</legend>
      <input type="hidden" name="skills" value={JSON.stringify(skills.filter((s) => s.name.trim()))} />
      {error && <p className="text-xs text-danger" role="alert">{error.join(" ")}</p>}
      <ul className="space-y-2">
        {skills.map((s, i) => (
          <li key={i} className="flex flex-wrap items-end gap-2">
            <div className="min-w-40 flex-1">
              <label htmlFor={`skill-${i}`} className="text-xs text-muted">Skill {i + 1}</label>
              <Input id={`skill-${i}`} value={s.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="e.g. JavaScript" />
            </div>
            <div className="w-24">
              <label htmlFor={`level-${i}`} className="text-xs text-muted">Level</label>
              <Select id={`level-${i}`} value={s.level} onChange={(e) => set(i, { level: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5].map((l) => <option key={l} value={l}>{l}</option>)}
              </Select>
            </div>
            <Button type="button" variant="ghost" onClick={() => setSkills(skills.filter((_, j) => j !== i))} aria-label={`Remove skill ${s.name || i + 1}`}>Remove</Button>
          </li>
        ))}
      </ul>
      <Button type="button" variant="secondary" className="mt-2" onClick={() => setSkills([...skills, { name: "", level: 3 }])}>Add skill</Button>
    </fieldset>
  );
}

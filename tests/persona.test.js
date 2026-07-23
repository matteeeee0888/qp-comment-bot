import { test } from "node:test";
import assert from "node:assert/strict";
import { personaFor, personaDirective } from "../lib/persona.js";

test("personaFor is deterministic for the same page id", () => {
  const a = personaFor("123", "Jane Doe", {});
  const b = personaFor("123", "Jane Doe", {});
  assert.deepEqual(a, b);
});

test("different page ids get (generally) different voices", () => {
  const voices = new Set();
  for (const id of ["100", "200", "300", "400", "500", "600", "700"]) {
    const p = personaFor(id, "P" + id, {});
    voices.add(`${p.archetype}|${p.tone}|${p.emoji}|${p.length}|${p.questionStyle}`);
  }
  assert.ok(voices.size >= 5, `expected varied voices across pages, got ${voices.size}`);
});

test("overrides win over the derived persona", () => {
  const p = personaFor("123", "Jane", { "123": { person: "we", archetype: "a community page" } });
  assert.equal(p.person, "we");
  assert.equal(p.archetype, "a community page");
});

test("personaDirective reflects singular vs plural voice", () => {
  const singular = personaDirective(personaFor("123", "Jane", {}));
  assert.match(singular, /first person \("I\/my"\)/);
  const plural = personaDirective(personaFor("123", "Jane", { "123": { person: "we" } }));
  assert.match(plural, /first-person PLURAL/);
});

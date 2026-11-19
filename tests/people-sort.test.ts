import { describe, expect, it } from "vitest";
import { parsePeopleSort, sortPeople } from "../src/lib/people-sort";

const p = (name: string, photo_count: number) => ({ name, photo_count });
const people = [p("marco", 12), p("Anna", 40), p("Élena", 12), p("Zoe", 3), p("Bruno 10", 0), p("Bruno 2", 0)];
const names = (list: { name: string }[]) => list.map((x) => x.name);

describe("sortPeople", () => {
  it("per nome, senza badare a maiuscole e accenti, numeri naturali", () => {
    expect(names(sortPeople(people, "nome"))).toEqual(["Anna", "Bruno 2", "Bruno 10", "Élena", "marco", "Zoe"]);
  });
  it("per numero di foto, decrescente, a pari numero per nome", () => {
    expect(names(sortPeople(people, "foto"))).toEqual(["Anna", "Élena", "marco", "Zoe", "Bruno 2", "Bruno 10"]);
  });
  it("accetta i conteggi come stringhe (COUNT di MySQL)", () => {
    expect(names(sortPeople([p("a", 0), { name: "b", photo_count: "9" }], "foto"))).toEqual(["b", "a"]);
  });
  it("non modifica l'elenco originale", () => {
    const copy = [...people];
    sortPeople(people, "foto");
    expect(people).toEqual(copy);
  });
});

describe("parsePeopleSort", () => {
  it("alfabetico se il cookie manca o non è valido", () => {
    expect(parsePeopleSort(undefined)).toBe("nome");
    expect(parsePeopleSort("boh")).toBe("nome");
    expect(parsePeopleSort("foto")).toBe("foto");
  });
});

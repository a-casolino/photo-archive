import { describe, expect, it } from "vitest";
import { parseAlbumSort, sortAlbums } from "../src/lib/album-sort";

const a = (title: string, d: string | null) => ({ title, date_from: d ? new Date(d) : null });
const albums = [
  a("Viaggio 10", "2019-05-01"),
  a("compleanno", "2016-07-10"),
  a("Senza data", null),
  a("Viaggio 2", "2019-05-01"),
  a("Ácqua", "2021-01-01"),
];
const titles = (list: { title: string }[]) => list.map((x) => x.title);

describe("sortAlbums", () => {
  it("per data, dal più recente, senza data in fondo e pari data per nome", () => {
    expect(titles(sortAlbums(albums, "recenti"))).toEqual(["Ácqua", "Viaggio 2", "Viaggio 10", "compleanno", "Senza data"]);
  });
  it("per data, dal meno recente, senza data sempre in fondo", () => {
    expect(titles(sortAlbums(albums, "vecchi"))).toEqual(["compleanno", "Viaggio 2", "Viaggio 10", "Ácqua", "Senza data"]);
  });
  it("per nome, senza badare a maiuscole e accenti, numeri naturali", () => {
    expect(titles(sortAlbums(albums, "nome"))).toEqual(["Ácqua", "compleanno", "Senza data", "Viaggio 2", "Viaggio 10"]);
    expect(titles(sortAlbums(albums, "nome_za"))).toEqual(["Viaggio 10", "Viaggio 2", "Senza data", "compleanno", "Ácqua"]);
  });
  it("non modifica l'elenco originale", () => {
    const copy = [...albums];
    sortAlbums(albums, "nome");
    expect(albums).toEqual(copy);
  });
});

describe("parseAlbumSort", () => {
  it("valore sconosciuto o assente → più recenti", () => {
    expect(parseAlbumSort(undefined)).toBe("recenti");
    expect(parseAlbumSort("boh")).toBe("recenti");
    expect(parseAlbumSort("nome_za")).toBe("nome_za");
  });
});

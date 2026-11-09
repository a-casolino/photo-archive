import { describe, expect, it } from "vitest";
import { dateFilterLabel, dateFilterParams, dateFilterSql, parseDateFilter } from "../src/lib/filter-rules";

describe("filtro per data di scatto", () => {
  it("legge anno, mese e giorno dall'URL e ignora i valori non validi", () => {
    expect(parseDateFilter({ anno: "2014", mese: "8", giorno: "12" })).toEqual({ year: 2014, month: 8, day: 12 });
    expect(parseDateFilter({ anno: "abc", mese: "13", giorno: "0" })).toEqual({});
    expect(parseDateFilter({ mese: ["7", "8"] })).toEqual({ month: 7 });
    expect(parseDateFilter({})).toEqual({});
  });

  it("riporta nell'URL solo le parti presenti", () => {
    expect(dateFilterParams({ year: 2014, day: 3 })).toEqual({ anno: "2014", giorno: "3" });
  });

  it("con l'anno usa un intervallo sulla colonna", () => {
    expect(dateFilterSql("p.taken_at", { year: 2014 })).toEqual({
      sql: ["p.taken_at >= ?", "p.taken_at < ?"],
      params: ["2014-01-01 00:00:00", "2015-01-01 00:00:00"],
    });
    expect(dateFilterSql("c", { year: 2014, month: 12 }).params).toEqual(["2014-12-01 00:00:00", "2015-01-01 00:00:00"]);
    expect(dateFilterSql("c", { year: 2016, month: 2, day: 29 }).params).toEqual([
      "2016-02-29 00:00:00",
      "2016-03-01 00:00:00",
    ]);
    expect(dateFilterSql("c", { year: 2014, day: 5 })).toEqual({
      sql: ["c >= ?", "c < ?", "DAYOFMONTH(c) = ?"],
      params: ["2014-01-01 00:00:00", "2015-01-01 00:00:00", 5],
    });
  });

  it("un giorno che non esiste non trova niente", () => {
    expect(dateFilterSql("c", { year: 2015, month: 2, day: 30 })).toEqual({ sql: ["FALSE"], params: [] });
  });

  it("senza anno confronta mese e giorno di ogni anno", () => {
    expect(dateFilterSql("c", { month: 8, day: 15 })).toEqual({
      sql: ["MONTH(c) = ?", "DAYOFMONTH(c) = ?"],
      params: [8, 15],
    });
    expect(dateFilterSql("c", {})).toEqual({ sql: [], params: [] });
  });

  it("descrive il filtro in italiano", () => {
    expect(dateFilterLabel({ year: 2014, month: 8, day: 12 })).toBe("12 agosto 2014");
    expect(dateFilterLabel({ year: 2014, month: 8 })).toBe("agosto 2014");
    expect(dateFilterLabel({ year: 2014 })).toBe("2014");
    expect(dateFilterLabel({ month: 8 })).toBe("agosto (tutti gli anni)");
    expect(dateFilterLabel({})).toBe("");
  });
});

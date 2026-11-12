const COUNTABLE_UNITS = new Set(["each", "piece", "pieces", "pc", "pcs", "unit", "units", "packet", "packets", "pack", "packs", "box", "boxes", "carton", "cartons", "case", "cases", "set", "sets"]);

export const isCountableUnit = (unit) => COUNTABLE_UNITS.has(String(unit ?? "").trim().toLocaleLowerCase());

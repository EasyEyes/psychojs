/**
 * Excel misreads a bare comma between numbers in a cell
 * (e.g. "1000,625" is displayed as 1,000,625). Ensure every comma in a
 * cell value is followed by a space. Arrays are emitted as their JSON
 * equivalent (whitespace after commas is legal JSON, so JSON.parse
 * consumers are unaffected).
 *
 * These helpers are applied at SAVE time, where rows become output — never
 * while recording. They are total functions: any failure returns the input
 * unchanged, so a bad cell or row can never prevent data from being saved.
 */

const SPACED = ", $1";

export const excelSafeCellValue = (value) => {
  try {
    if (Array.isArray(value)) {
      return JSON.stringify(value).replace(/,(\S)/g, SPACED);
    }
    if (typeof value === "string") {
      return value.replace(/,(\S)/g, SPACED);
    }
    return value;
  } catch (e) {
    // Unstringifiable array (BigInt element, circular reference, ...):
    // return the original value; behavior is then exactly upstream's.
    return value;
  }
};

export const excelSafeRows = (rows) => {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) => {
    try {
      return Object.fromEntries(
        Object.entries(row).map(([k, v]) => [k, excelSafeCellValue(v)]),
      );
    } catch (e) {
      // Throwing getter or non-object row: pass through unchanged.
      return row;
    }
  });
};

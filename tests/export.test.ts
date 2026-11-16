import { expect, it } from "vitest";
import ExcelJS from "exceljs";
import { workbookBuffer } from "../src/export";
import { emptyReading } from "../supabase/functions/_shared/health";
it("exports a real XLSX retaining raw values, blanks and safe text notes", async () => {
  const r = {
    ...emptyReading(),
    measured_on: "2025-01-03",
    glucose_mmol: 4.8,
    glucose_mg_reported: 87.2,
    notes: "=SYNTHETIC(1)",
    source_key: "synthetic-1",
  };
  const bytes = await workbookBuffer([r]);
  expect(new Uint8Array(bytes).slice(0, 2)).toEqual(new Uint8Array([80, 75]));
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  const sheet = book.getWorksheet("健康紀錄")!;
  expect(sheet.rowCount).toBe(2);
  expect(sheet.getCell("B2").value).toBe("未記時間");
  expect(sheet.getCell("E2").value).toBe(87.2);
  expect(sheet.getCell("F2").value).toBeNull();
  expect(sheet.getCell("J2").value).toBe("=SYNTHETIC(1)");
  expect(sheet.getCell("J2").type).toBe(ExcelJS.ValueType.String);
});
it("exports the first raw snapshot separately from a later correction", async () => {
  const r = {
    ...emptyReading(),
    weight_kg: 60,
    glucose_mmol: 6,
    glucose_mg_reported: 108,
    notes: "corrected",
    original_data: {
      glucose_mmol: null,
      glucose_mg_reported: null,
      notes: "first synthetic note",
    },
  };
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await workbookBuffer([r]));
  const sheet = book.getWorksheet("健康紀錄")!;
  expect(sheet.getCell("M2").value).toBeNull();
  expect(sheet.getCell("N2").value).toBeNull();
  expect(sheet.getCell("O2").value).toBe("first synthetic note");
});

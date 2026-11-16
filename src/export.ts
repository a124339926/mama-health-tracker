import type { Reading } from '../supabase/functions/_shared/health';
export async function excel(rows:Reading[],month:string) {
 const {default:ExcelJS}=await import('exceljs');
 const book=new ExcelJS.Workbook(); const sheet=book.addWorksheet('健康紀錄');
 sheet.addRow(['日期','時間','測量類型','血糖 mmol/L','原始血糖 mg/dL','體重 kg','收縮壓 mmHg','舒張壓 mmHg','心率 次/分','原始註記／備註','來源','來源識別碼']);
 for(const r of rows) sheet.addRow([r.measured_on,r.measured_time||'未記時間',({fasting:'空腹',postmeal:'餐後',other:'其他'})[r.measurement_type],r.glucose_mmol,r.glucose_mg_reported,r.weight_kg,r.systolic,r.diastolic,r.pulse,r.notes,r.source,r.source_key]);
 sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}}; sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF2F795D'}};
 sheet.columns.forEach((c,i)=>c.width=i===9?55:i===11?36:18); sheet.views=[{state:'frozen',ySplit:1}]; sheet.autoFilter='A1:L1';
 const blob=new Blob([await book.xlsx.writeBuffer() as ArrayBuffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
 const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`媽媽健康紀錄_${month}.xlsx`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}

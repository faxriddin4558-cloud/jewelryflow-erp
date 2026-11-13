#!/usr/bin/env python3
"""Generates goldia-opening-template.xlsx: the owner's sheet for the REAL opening balances at T0 (PHASE F).
One sheet per opening document kind of /sales/app/opening (A..J); the columns are exactly the fields of that form.
Formulas compute the same values the server computes (factory / seller obligation, 585 equivalents), so the
"Jamlama" sheet can be compared line by line with the reconciliation totals shown on the page before the lock."""
import sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.worksheet.datavalidation import DataValidation

out = sys.argv[1] if len(sys.argv) > 1 else "goldia-opening-template.xlsx"
wb = Workbook()
H = Font(bold=True, color="FFFFFF"); FILL = PatternFill("solid", fgColor="1F2937"); CALC = PatternFill("solid", fgColor="E5E7EB")
ROWS = 200


def sheet(title, note, cols, calc=None, first=False):
    ws = wb.active if first else wb.create_sheet()
    ws.title = title
    ws["A1"] = note; ws["A1"].font = Font(bold=True); ws["A1"].alignment = Alignment(wrap_text=True)
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(cols) + len(calc or []))
    ws.row_dimensions[1].height = 48
    for i, c in enumerate(cols + [c for c, _ in (calc or [])], start=1):
        cell = ws.cell(row=2, column=i, value=c); cell.font = H; cell.fill = FILL
        ws.column_dimensions[cell.column_letter].width = max(14, len(c) + 2)
    for j, (_, f) in enumerate(calc or [], start=len(cols) + 1):
        for r in range(3, ROWS + 3):
            cell = ws.cell(row=r, column=j, value=f.format(r=r)); cell.fill = CALC
    ws.freeze_panes = "A3"
    return ws


def choice(ws, col, values):
    dv = DataValidation(type="list", formula1='"' + ",".join(values) + '"', allow_blank=True)
    ws.add_data_validation(dv); dv.add(f"{col}3:{col}{ROWS + 2}")


ws = sheet("T0", "T0 = barcha tuzatishlar tugagan, haqiqiy savdo boshlanishidan OLDINGI vaqt (Asia/Tashkent). Sotuvchilarning pul va LOM'i T0 dan oldin menejerga topshirilgan bo'lishi shart.",
           ["Maydon", "Qiymat"], first=True)
for i, (k, v) in enumerate([("T0 sana (YYYY-MM-DD)", ""), ("T0 vaqt (HH:MM, Toshkent)", ""), ("585 kursi (so'm / g) - qulflash kuni", ""), ("USD kursi (so'm) - qulflash kuni", ""),
                            ("Sotuvchilar kassasi T0 da bo'sh (ha / yo'q)", ""), ("Tayyorladi", ""), ("Tekshirdi", "")], start=3):
    ws.cell(row=i, column=1, value=k); ws.cell(row=i, column=2, value=v)

ws = sheet("A Menejer ombori", "A. Menejerdagi zavoddan qarzga olingan tayyor mahsulot. Zavod majburiyati = fizik g x (1 + zavod %). Foiz ASL fizik grammga, compounded emas.",
           ["Partiya / mahsulot nomi", "Fizik vazn (g)", "Zavod ustamasi (%)", "Izoh"], [("Zavod majburiyati (g) [hisob]", "=IF(B{r}=\"\",\"\",ROUND(B{r}*(1+C{r}/100),4))")])
ws = sheet("B Sotuvchi ombori", "B. Har bir sotuvchining qo'lidagi mahsulot (zavoddan menejer orqali). Manba = A dagi partiya bo'lsa menejer omboridan ayriladi va zavod majburiyati O'ZGARMAYDI. Sotuvchi majburiyati = fizik g x (1 + sotuvchi %).",
           ["Sotuvchi (ism)", "Dona vaznlari (bo'shliq bilan: 14.52 8.3 10)", "Jami fizik vazn (g)", "Sotuvchi ustamasi (%)", "Manba: A dagi partiya nomi (bo'sh = faqat sotuvchida)", "Zavod ustamasi (%) - manba bo'sh bo'lsa", "Izoh"],
           [("Sotuvchi majburiyati (g) [hisob]", "=IF(C{r}=\"\",\"\",ROUND(C{r}*(1+D{r}/100),4))"),
            ("Qo'shimcha zavod majburiyati (g) [manba bo'sh]", "=IF(OR(C{r}=\"\",E{r}<>\"\"),\"\",ROUND(C{r}*(1+F{r}/100),4))")])
ws = sheet("C Zavod majburiyati", "C. Mahsulotsiz zavod majburiyati (585 g): oldin sotilgan, lekin zavodga hali to'lanmagan mahsulotlar va boshqa zavod qarzlari. C2 = zavodga berilgan avans.",
           ["Turi (C majburiyat / C2 avans)", "Miqdor (585 g)", "Asos / izoh"])
choice(ws, "A", ["C majburiyat", "C2 avans"])
ws = sheet("D Sotuvchi majburiyati", "D. Sotuvchining menejer oldidagi QO'SHIMCHA majburiyati (ombordan tashqari), 585 g. Asos majburiy.",
           ["Sotuvchi (ism)", "Miqdor (585 g)", "Asos (majburiy)"])
ws = sheet("E Mijoz 585 g", "E. Har bir mijozning 585 g qarzi YOKI avansi (bir mijozga bitta qator). Mijoz sotuvchiga biriktirilgan bo'lsa, qarz sotuvchi majburiyatiga ham qo'shiladi.",
           ["Mijoz (ism)", "Mijoz kodi", "Telefon", "Biriktirilgan sotuvchi", "Turi (qarz / avans)", "Miqdor (585 g)", "Izoh"])
choice(ws, "E", ["qarz", "avans"])
ws = sheet("F Mijoz so'm-USD", "F. Mijozning so'm yoki USD qarzi / avansi. 585 g ekvivalenti tasdiqlangan kurs snapshoti bilan saqlanadi: so'm / 585 kursi; USD x USD kursi / 585 kursi. 585 g qarzi (E) bilan bir majburiyatni ikki marta kiritmang.",
           ["Mijoz (ism)", "Mijoz kodi", "Biriktirilgan sotuvchi", "Valyuta (UZS / USD)", "Turi (qarz / avans)", "Summa", "USD kursi (so'm) - USD uchun", "585 kursi (so'm / g)", "Izoh"],
           [("585 g ekvivalenti [hisob]", "=IF(F{r}=\"\",\"\",IF(D{r}=\"USD\",ROUND(F{r}*G{r}/H{r},4),ROUND(F{r}/H{r},4)))")])
choice(ws, "D", ["UZS", "USD"]); choice(ws, "E", ["qarz", "avans"])
ws = sheet("G Menejer kassasi", "G. Menejerning haqiqiy kassasi T0 da (sotuvchilardan topshirilgan pul ham shu yerda).", ["Valyuta (UZS / USD)", "Summa", "Izoh"])
choice(ws, "A", ["UZS", "USD"])
ws = sheet("H LOM", "H. Menejerdagi LOM: fizik vazn va proba. 585 ekvivalenti = fizik g x proba / 585.", ["Fizik vazn (g)", "Proba", "Izoh"],
           [("585 g ekvivalenti [hisob]", "=IF(A{r}=\"\",\"\",ROUND(A{r}*B{r}/585,4))")])
ws = sheet("I Toza oltin", "I. Menejerdagi toza (affinaj) oltin. 585 ekvivalenti = fizik g x proba / 585; sof oltin = fizik g x proba / 1000.", ["Fizik vazn (g)", "Proba", "Izoh"],
           [("585 g ekvivalenti [hisob]", "=IF(A{r}=\"\",\"\",ROUND(A{r}*B{r}/585,4))"), ("Sof oltin (g) [hisob]", "=IF(A{r}=\"\",\"\",ROUND(A{r}*B{r}/1000,4))")])
ws = sheet("J Boshqa", "J. Boshqa aktiv (bizga qarz) yoki majburiyat (bizning qarzimiz): ustaxona, ijaraga, shaxsiy qarzlar va hokazo.",
           ["Turi (aktiv / majburiyat)", "Birlik (UZS / USD / 585 g / oltin)", "Summa / miqdor", "Proba - oltin uchun", "USD kursi", "585 kursi", "Qarz turi", "Qarshi tomon", "Izoh"])
choice(ws, "A", ["aktiv", "majburiyat"]); choice(ws, "B", ["UZS", "USD", "585 g", "oltin"])

ws = sheet("Jamlama", "Jamlama: shu qiymatlar /sales/app/opening sahifasidagi 'Solishtirish' (reconciliation) jami bilan qulflashdan OLDIN bir xil bo'lishi kerak.",
           ["Ko'rsatkich", "Jadval bo'yicha", "Sahifada (qo'lda yozing)", "Farq"])
lines = [
    ("Menejer ombori (g) = A - B (manbali)", "=SUM('A Menejer ombori'!B3:B202)-SUMIF('B Sotuvchi ombori'!E3:E202,\"<>\",'B Sotuvchi ombori'!C3:C202)"),
    ("Sotuvchilar ombori (g)", "=SUM('B Sotuvchi ombori'!C3:C202)"),
    ("Zavod majburiyati (g) = A + B(manbasiz) + C - C2", "=SUM('A Menejer ombori'!E3:E202)+SUM('B Sotuvchi ombori'!I3:I202)+SUMIF('C Zavod majburiyati'!A3:A202,\"C majburiyat\",'C Zavod majburiyati'!B3:B202)-SUMIF('C Zavod majburiyati'!A3:A202,\"C2 avans\",'C Zavod majburiyati'!B3:B202)"),
    ("Sotuvchilar majburiyati (g) = B + D + sotuvchi mijozlari qarzi (E, F qarz)", "=SUM('B Sotuvchi ombori'!H3:H202)+SUM('D Sotuvchi majburiyati'!B3:B202)+SUMIFS('E Mijoz 585 g'!F3:F202,'E Mijoz 585 g'!E3:E202,\"qarz\",'E Mijoz 585 g'!D3:D202,\"<>\")+SUMIFS('F Mijoz so''m-USD'!J3:J202,'F Mijoz so''m-USD'!E3:E202,\"qarz\",'F Mijoz so''m-USD'!C3:C202,\"<>\")"),
    ("Mijozlar 585 g qarzi", "=SUMIF('E Mijoz 585 g'!E3:E202,\"qarz\",'E Mijoz 585 g'!F3:F202)"),
    ("Mijozlar 585 g avansi", "=SUMIF('E Mijoz 585 g'!E3:E202,\"avans\",'E Mijoz 585 g'!F3:F202)"),
    ("Mijozlar so'm qarzi", "=SUMIFS('F Mijoz so''m-USD'!F3:F202,'F Mijoz so''m-USD'!D3:D202,\"UZS\",'F Mijoz so''m-USD'!E3:E202,\"qarz\")"),
    ("Mijozlar so'm avansi", "=SUMIFS('F Mijoz so''m-USD'!F3:F202,'F Mijoz so''m-USD'!D3:D202,\"UZS\",'F Mijoz so''m-USD'!E3:E202,\"avans\")"),
    ("Mijozlar USD qarzi", "=SUMIFS('F Mijoz so''m-USD'!F3:F202,'F Mijoz so''m-USD'!D3:D202,\"USD\",'F Mijoz so''m-USD'!E3:E202,\"qarz\")"),
    ("Mijozlar USD avansi", "=SUMIFS('F Mijoz so''m-USD'!F3:F202,'F Mijoz so''m-USD'!D3:D202,\"USD\",'F Mijoz so''m-USD'!E3:E202,\"avans\")"),
    ("Menejer kassasi so'm", "=SUMIF('G Menejer kassasi'!A3:A202,\"UZS\",'G Menejer kassasi'!B3:B202)"),
    ("Menejer kassasi USD", "=SUMIF('G Menejer kassasi'!A3:A202,\"USD\",'G Menejer kassasi'!B3:B202)"),
    ("LOM fizik (g)", "=SUM('H LOM'!A3:A202)"),
    ("LOM 585 ekv. (g)", "=SUM('H LOM'!D3:D202)"),
    ("Toza oltin 585 ekv. (g)", "=SUM('I Toza oltin'!D3:D202)"),
    ("Sotuvchilar kassasi T0 da (0 bo'lishi shart)", "0"),
]
for i, (k, f) in enumerate(lines, start=3):
    ws.cell(row=i, column=1, value=k); ws.cell(row=i, column=2, value=f if not f.isdigit() else int(f))
    ws.cell(row=i, column=4, value=f"=IF(C{i}=\"\",\"\",ROUND(B{i}-C{i},4))")
ws.column_dimensions["A"].width = 70
wb.save(out)
print("written", out)

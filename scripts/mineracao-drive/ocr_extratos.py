#!/usr/bin/env python3
"""
ITEM 7 (alvo certo) — OCR dos EXTRATOS digitalizados (layout='sem_texto' na extracao).
Aqui o OCR rende, porque o arquivo JA e um extrato conhecido: falta so a camada de texto.
Reaproveita os parsers de parcela (A/C/D) e as travas de plausibilidade.

  python3 ocr_extratos.py <out.jsonl> [limite] [workers]
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from multiprocessing import Pool

SCRATCH = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRATCH)
import parcelas as P  # noqa

MAX_PAG = 8

def ocr(path):
    tmp = tempfile.mkdtemp(prefix="ocrx_")
    try:
        subprocess.run(["pdftoppm", "-r", "300", "-f", "1", "-l", str(MAX_PAG), "-png",
                        path, os.path.join(tmp, "p")], capture_output=True, timeout=300)
        out = []
        for img in sorted(os.listdir(tmp)):
            if img.endswith(".png"):
                r = subprocess.run(["tesseract", os.path.join(tmp, img), "stdout",
                                    "-l", "por", "--psm", "6"], capture_output=True, timeout=180)
                out.append(r.stdout.decode("utf-8", "ignore"))
        return "\n".join(out)
    except Exception:
        return ""
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

def processar(path):
    txt = ocr(path)
    if len(txt) < 400:
        return None
    layout = P.detectar_layout(txt)
    saida = []
    for titulo, trecho in P.segmentar_por_titulo(txt):
        cab = trecho[:2500]
        emp = None
        for rx in (P.RE_EMPREEND2, P.RE_EMPREEND):
            m = rx.search(cab)
            if m:
                emp = m.group(1).strip()[:80]
                break
        if not emp:
            mp = P.RE_PRODUTO.search(cab)
            if mp:
                emp = mp.group(1).split("/")[0].strip()[:80]
        rec = {"path": path, "arquivo": os.path.basename(path) + " (OCR)", "bucket": "ocr",
               "layout": layout + "_ocr", "titulo": titulo,
               "cpfs": list(dict.fromkeys(P.only_digits(c) for c in P.RE_CPF.findall(cab)))[:5],
               "empreendimento_extrato": emp,
               "unidade": (P.RE_UNIDADE.search(cab).group(1) if P.RE_UNIDADE.search(cab) else None),
               "documento": (P.RE_DOC.search(cab).group(1) if P.RE_DOC.search(cab) else None)}
        rec.update(P.medir_bloco(trecho, layout))
        if rec.get("n_parcelas_pagas"):
            saida.append(rec)
    return saida or None

def main():
    out_path = sys.argv[1]
    limite = int(sys.argv[2]) if len(sys.argv) > 2 else 10**9
    workers = int(sys.argv[3]) if len(sys.argv) > 3 else 6
    # alvos: os que a extracao marcou como sem texto
    alvos = []
    with open(os.path.join(SCRATCH, "parcelas_extraidas.jsonl")) as fh:
        for l in fh:
            r = json.loads(l)
            if r.get("layout") == "sem_texto" and r.get("path"):
                alvos.append(r["path"])
    alvos = sorted(set(alvos))[:limite]
    print(json.dumps({"extratos_digitalizados": len(alvos)}), flush=True)
    n_ok, feito = 0, 0
    with open(out_path, "w") as fh, Pool(workers) as pool:
        for res in pool.imap_unordered(processar, alvos, chunksize=1):
            feito += 1
            if res:
                for rec in res:
                    fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
                n_ok += 1
            if feito % 25 == 0:
                print(json.dumps({"processados": feito, "com_parcelas": n_ok}), flush=True)
    print(json.dumps({"processados": feito, "com_parcelas": n_ok}, indent=1))

if __name__ == "__main__":
    main()

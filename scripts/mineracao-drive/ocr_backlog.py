#!/usr/bin/env python3
"""
ITEM 7 — OCR dos documentos DIGITALIZADOS (sem camada de texto), com tesseract local.
Alvos: extratos sem texto + contratos de compra da cota (onde estao forma de pagamento,
entrada e financiamento). Roda pdftoppm -> tesseract -l por, e reaproveita os mesmos
extratores/travas (CPF do documento) do pipeline principal.

  python3 ocr_backlog.py <fila_clientes.txt> <out.json> [max_docs] [workers]
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from multiprocessing import Pool

SCRATCH = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRATCH)
from mina_cpf import BUCKETS, norm, only_digits, carregar_fila  # noqa
from cauda import extrair_campos, prio  # noqa

MAX_PAG = 6          # OCR e caro: primeiras paginas resolvem (qualificacao + fatos)
CPFS = {}

def _init(cpfs):
    global CPFS
    CPFS = cpfs

def tem_texto(path):
    try:
        r = subprocess.run(["pdftotext", "-l", "2", path, "-"], capture_output=True, timeout=30)
        return len(r.stdout.decode("utf-8", "ignore").strip()) > 250
    except Exception:
        return False

def ocr(path):
    """pdftoppm (300dpi) -> tesseract por pagina; devolve o texto concatenado."""
    tmp = tempfile.mkdtemp(prefix="ocr_")
    try:
        subprocess.run(["pdftoppm", "-r", "300", "-f", "1", "-l", str(MAX_PAG),
                        "-png", path, os.path.join(tmp, "p")],
                       capture_output=True, timeout=240)
        partes = []
        for img in sorted(os.listdir(tmp)):
            if not img.endswith(".png"):
                continue
            r = subprocess.run(["tesseract", os.path.join(tmp, img), "stdout", "-l", "por", "--psm", "6"],
                               capture_output=True, timeout=180)
            partes.append(r.stdout.decode("utf-8", "ignore"))
        return "\n".join(partes)
    except Exception:
        return ""
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

def alvos_do_cliente(nome):
    """pastas cujo nome (em qualquer um dos 3 niveis) casa com o cliente."""
    hits = []
    nn = norm(nome)
    for _bucket, root in BUCKETS:
        if not os.path.isdir(root):
            continue
        for dirpath, _d, files in os.walk(root):
            base = norm(os.path.basename(dirpath))
            if base == nn and any(f.lower().endswith(".pdf") for f in files):
                hits.append(dirpath)
    return hits[:2]

def processar(cli):
    cpf = cli["c"]
    for pasta in alvos_do_cliente(cli["n"]):
        try:
            arquivos = [f for f in os.listdir(pasta) if f.lower().endswith(".pdf")]
        except OSError:
            continue
        arquivos.sort(key=lambda f: -prio(f))
        for f in arquivos[:4]:
            p = os.path.join(pasta, f)
            try:
                if os.path.getsize(p) > 30_000_000 or tem_texto(p):
                    continue           # so digitalizados
            except OSError:
                continue
            txt = ocr(p)
            if len(txt) < 300:
                continue
            if cpf not in only_digits(txt[:15000]):
                continue               # trava: CPF do documento tem de conferir
            ex = extrair_campos(txt, cpf)
            if not ex.get("valor_pago") and not ex.get("resort_bruto"):
                continue
            ex.update({"cliente_id": cli["i"], "cpf": cpf, "nome_cadastro": cli["n"],
                       "arquivo": f + " (OCR)", "bucket": "ocr", "pasta_local": pasta,
                       "via": "ocr"})
            return ex
    return None

def main():
    fila = carregar_fila(sys.argv[1])
    out_path = sys.argv[2]
    limite = int(sys.argv[3]) if len(sys.argv) > 3 else 10**9
    workers = int(sys.argv[4]) if len(sys.argv) > 4 else 6
    fila = fila[:limite]
    cpfs = {c["c"]: c for c in fila if len(c.get("c", "")) == 11}
    print(json.dumps({"fila": len(fila)}), flush=True)
    ok, feito = [], 0
    with Pool(workers, initializer=_init, initargs=(cpfs,)) as pool:
        for r in pool.imap_unordered(processar, fila, chunksize=1):
            feito += 1
            if r:
                ok.append(r)
            if feito % 25 == 0:
                print(json.dumps({"processados": feito, "achados": len(ok)}), flush=True)
    json.dump(ok, open(out_path, "w"), ensure_ascii=False)
    print(json.dumps({"processados": feito, "resolvidos": len(ok),
                      "com_valor": sum(1 for r in ok if r.get("valor_pago")),
                      "com_resort": sum(1 for r in ok if r.get("resort_bruto"))}, indent=1))

if __name__ == "__main__":
    main()

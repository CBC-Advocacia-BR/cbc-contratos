#!/usr/bin/env python3
"""
Varredura AMPLA para o residual: varre TODAS as pastas (nao filtra por nome) e casa por
CPF do documento. Resolve o caso do CASAL — a pasta esta no nome do conjuge, entao o
cliente nunca era encontrado por nome. Processa ate N docs por pasta, priorizados.

  python3 varredura_ampla.py <fila.txt> <out.json> [workers] [max_docs_por_pasta]
"""
import json
import os
import re
import sys
from multiprocessing import Pool

SCRATCH = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRATCH)
from mina_cpf import BUCKETS, norm, only_digits, carregar_fila  # noqa
from cauda import prio, texto, extrair_campos  # noqa

CPFS = {}       # cpf -> cliente
MAXDOCS = 5

def _init(cpfs, maxdocs):
    global CPFS, MAXDOCS
    CPFS, MAXDOCS = cpfs, maxdocs

def processar_pasta(args):
    pasta, bucket = args
    try:
        arquivos = [f for f in os.listdir(pasta) if f.lower().endswith(".pdf")]
    except OSError:
        return []
    if not arquivos:
        return []
    arquivos.sort(key=lambda f: -prio(f))
    out = []
    vistos = set()
    for f in arquivos[:MAXDOCS]:
        p = os.path.join(pasta, f)
        try:
            if os.path.getsize(p) > 25_000_000:
                continue
        except OSError:
            continue
        txt = texto(p, paginas=6)
        if len(txt) < 300:
            continue
        digs = only_digits(txt[:12000])
        # procura QUALQUER cpf da fila residual dentro do documento
        for cpf, cli in CPFS.items():
            if cpf in vistos or cpf not in digs:
                continue
            ex = extrair_campos(txt, cpf)
            if not ex.get("valor_pago") and not ex.get("resort_bruto"):
                continue
            ex.update({"cliente_id": cli["i"], "cpf": cpf, "nome_cadastro": cli["n"],
                       "arquivo": f, "bucket": bucket, "pasta_local": pasta})
            out.append(ex)
            vistos.add(cpf)
    return out

def listar_pastas():
    ps = []
    for bucket, root in BUCKETS:
        if not os.path.isdir(root):
            continue
        for dirpath, _d, files in os.walk(root):
            if any(f.lower().endswith(".pdf") for f in files):
                ps.append((dirpath, bucket))
    return ps

def main():
    fila = carregar_fila(sys.argv[1])
    out_path = sys.argv[2]
    workers = int(sys.argv[3]) if len(sys.argv) > 3 else 10
    maxdocs = int(sys.argv[4]) if len(sys.argv) > 4 else 5
    cpfs = {c["c"]: c for c in fila if len(c.get("c", "")) == 11}
    pastas = listar_pastas()
    print(json.dumps({"pastas_com_pdf": len(pastas), "cpfs_alvo": len(cpfs)}), flush=True)
    achados, feito = [], 0
    with Pool(workers, initializer=_init, initargs=(cpfs, maxdocs)) as pool:
        for res in pool.imap_unordered(processar_pasta, pastas, chunksize=4):
            achados.extend(res)
            feito += 1
            if feito % 500 == 0:
                print(json.dumps({"pastas": feito, "achados": len(achados)}), flush=True)
    # dedupe por cliente (mantem o registro com mais campos)
    melhor = {}
    for a in achados:
        k = a["cliente_id"]
        score = sum(1 for x in ("valor_pago", "resort_bruto", "data_contrato_compra", "qual", "unidade_cota") if a.get(x))
        if k not in melhor or score > melhor[k][0]:
            melhor[k] = (score, a)
    final = [v[1] for v in melhor.values()]
    json.dump(final, open(out_path, "w"), ensure_ascii=False)
    print(json.dumps({"pastas_varridas": feito, "clientes_resolvidos": len(final),
                      "com_valor": sum(1 for a in final if a.get("valor_pago")),
                      "com_resort": sum(1 for a in final if a.get("resort_bruto")),
                      "com_qual": sum(1 for a in final if a.get("qual"))}, indent=1))

if __name__ == "__main__":
    main()

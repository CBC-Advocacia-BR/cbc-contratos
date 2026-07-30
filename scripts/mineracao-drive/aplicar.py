#!/usr/bin/env python3
"""Envia os registros minerados ao banco via RPC (lotes de 100). Zero output sensivel."""
import glob
import json
import os
import re
import subprocess
import sys

SCRATCH = os.path.dirname(os.path.abspath(__file__))
URL = "https://vygczeepvoyaehfchxko.supabase.co/rest/v1/rpc/acoes_drive_ingest_t"
TICKET = sys.argv[1]
DIST = "/Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos/client/dist/assets/*.js"

ak = None
for f in glob.glob(DIST):
    m = re.search(r"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9[A-Za-z0-9_.-]{40,}", open(f, "rb").read().decode("utf-8", "ignore"))
    if m:
        ak = m.group(0)
        break
if not ak:
    sys.exit("anon key nao encontrada no bundle")


def data_ok(d):
    """descarta data impossivel (dd/mm invertido virou mes 13+)"""
    if not d:
        return None
    try:
        y, m, dd = (int(x) for x in d.split("-"))
        return d if 1990 <= y <= 2026 and 1 <= m <= 12 and 1 <= dd <= 31 else None
    except Exception:
        return None

SRC = sys.argv[2] if len(sys.argv) > 2 else "casados.json"
_raw = json.load(open(os.path.join(SCRATCH, SRC)))
casados = _raw if isinstance(_raw, dict) else {str(i): [x] for i, x in enumerate(_raw)}
rows = []
for cid, itens in casados.items():
    vistos = set()
    for it in itens:
        chave = (it.get("arquivo") or "")
        if chave in vistos:
            continue
        vistos.add(chave)
        rows.append({k: it.get(k) for k in (
            "cliente_id", "cpf", "nome_cadastro", "arquivo", "bucket", "valor_pago",
            "valor_pago_texto", "data_contrato_compra", "unidade_cota", "resort_bruto",
            "reu_resort", "tipo_acao", "conjuge_cpf", "conjuge_nome", "qual", "cep",
            "email", "endereco")} | {"pasta_local": it.get("path"),
                                  "data_contrato_compra": data_ok(it.get("data_contrato_compra"))})

tot = {"inseridos": 0, "ja_existiam": 0, "p_revisar": 0, "qualificacao_aplicada": 0, "erros": 0}
LOTE = 100
for i in range(0, len(rows), LOTE):
    payload = json.dumps({"p_ticket": TICKET, "p_rows": rows[i:i + LOTE]}, ensure_ascii=False)
    p = subprocess.run(
        ["curl", "-s", "-X", "POST", URL, "-H", f"apikey: {ak}", "-H", f"Authorization: Bearer {ak}",
         "-H", "Content-Type: application/json", "--data-binary", "@-"],
        input=payload.encode(), capture_output=True, timeout=180)
    try:
        r = json.loads(p.stdout.decode())
        if isinstance(r, dict) and "inseridos" in r:
            for k in ("inseridos", "ja_existiam", "p_revisar", "qualificacao_aplicada"):
                tot[k] += r.get(k, 0)
        else:
            tot["erros"] += 1
            tot.setdefault("ultimo_erro", str(r)[:200])
    except Exception as e:
        tot["erros"] += 1
        tot.setdefault("ultimo_erro", f"{e}: {p.stdout[:150]}")
print(json.dumps({"linhas_enviadas": len(rows), **tot}, indent=1, ensure_ascii=False))

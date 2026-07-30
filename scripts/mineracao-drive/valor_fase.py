#!/usr/bin/env python3
"""
Valor ATUALIZADO da acao nas fases posteriores (regra Paulo 29/07/2026):
- liquidacao/cumprimento de sentenca -> valor CALCULADO na fase
- SISBAJUD -> valor do PEDIDO de penhora (+ mes do pedido)
Liquidacao e cumprimento sao FASES da acao principal: nunca somam como acao nova.

Estrategia = varredura AMPLA (mesma licao do varredura_ampla.py: casais compartilham
pasta, entao localizar por nome falha). Varre TODOS os buckets pegando documentos cujo
NOME indica fase, extrai o texto e casa pelo CPF LIDO NO DOCUMENTO. O join CPF->cliente
fica no servidor (a RPC casa), por isso o script nao precisa da lista de CPFs.

  python3 valor_fase.py <out.json> [workers] [limite]
"""
import json
import os
import re
import subprocess
import sys
from multiprocessing import Pool

SCRATCH = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRATCH)
from mina_cpf import BUCKETS, norm, only_digits, parse_valor  # noqa

RE_CPF = re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b")


def prio_fase(nome):
    """peso do documento + a fase que ele representa"""
    n = norm(nome)
    if re.search(r"sisbajud|bacenjud", n):
        return 100, "sisbajud"
    if re.search(r"liquida", n):
        return 90, "liquidacao"
    if re.search(r"cumprimento", n):
        return 85, "cumprimento"
    if re.search(r"penhora|bloqueio|arresto", n):
        return 80, "penhora"
    if re.search(r"calculo|planilha|memoria", n):
        return 70, "calculo"
    return 0, None


# rotulos reais (colhidos dos documentos), em ordem de preferencia.
# o alvo e o DEBITO do cliente: custas e honorarios sucumbenciais ficam de fora.
RE_VALOR_FASE = [
    r"d[eé]bito atualizado.{0,120}?R\$\s*([\d.]+,\d{2})",
    r"valor (?:total )?(?:atualizado )?d[oa] d[eé]bito.{0,120}?R\$\s*([\d.]+,\d{2})",
    r"(?:requer|requer-se|postula|pugna)[^.]{0,160}?(?:bloqueio|penhora|sisbajud).{0,120}?R\$\s*([\d.]+,\d{2})",
    r"(?:bloqueio|penhora) (?:de|no valor de|do valor de).{0,90}?R\$\s*([\d.]+,\d{2})",
    r"condena[cç][aã]o (?:corresponde|equivale|importa|[eé]|foi)[^\d]{0,40}?R\$\s*([\d.]+,\d{2})",
    r"valor (?:l[íi]quido|apurado|encontrado|remanescente).{0,100}?R\$\s*([\d.]+,\d{2})",
    r"total (?:geral|devido|apurado|a (?:ser )?(?:pago|bloqueado|restitu[íi]do)).{0,100}?R\$\s*([\d.]+,\d{2})",
    r"valor (?:da )?(?:execu[cç][aã]o|liquida[cç][aã]o).{0,100}?R\$\s*([\d.]+,\d{2})",
    r"valor atualizado.{0,110}?R\$\s*([\d.]+,\d{2})",
    r"d[aá] (?:-se )?[aà] causa o valor de.{0,60}?R\$\s*([\d.]+,\d{2})",
]
# nunca aceitar valor cujo rotulo imediatamente anterior seja acessorio
RE_PROIBIDO = re.compile(
    r"honor[aá]ri|custas|sucumb|multa de|per[ií]cia|dilig[eê]ncia|contratual de|"
    r"astreinte|dano moral|taxa|preparo",
    re.IGNORECASE)
MIN_V, MAX_V = 1000.0, 3_000_000.0
RE_DATA = re.compile(r"\b(\d{2})/(\d{2})/(20\d{2})\b")


def texto(p, pag=10):
    try:
        r = subprocess.run(["pdftotext", "-layout", "-f", "1", "-l", str(pag), p, "-"],
                           capture_output=True, timeout=90)
        return r.stdout.decode("utf-8", "ignore")
    except Exception:
        return ""


def processar(path):
    peso, fase = prio_fase(os.path.basename(path))
    if not fase:
        return None
    try:
        if os.path.getsize(path) > 30_000_000:
            return None
    except OSError:
        return None
    t = texto(path)
    if len(t) < 400:
        return None
    cab = t[:9000]
    cpfs = []
    for c in RE_CPF.findall(cab):
        d = only_digits(c)
        if len(d) == 11 and d not in cpfs:
            cpfs.append(d)
    if not cpfs:
        return None
    valor, trecho = None, None
    for pat in RE_VALOR_FASE:
        for m in re.finditer(pat, t, re.IGNORECASE | re.DOTALL):
            ctx = t[max(0, m.start() - 90):m.start() + 30]
            if RE_PROIBIDO.search(ctx):
                continue
            v = parse_valor(m.group(1))
            if v and MIN_V <= v <= MAX_V:
                valor = v
                trecho = re.sub(r"\s+", " ", t[max(0, m.start() - 90):m.end() + 10]).strip()[:230]
                break
        if valor:
            break
    if not valor:
        return None
    # data do documento (mes do pedido SISBAJUD): a mais recente do texto
    mes = None
    datas = []
    for d, mo, a in RE_DATA.findall(t):
        try:
            di, mi, ai = int(d), int(mo), int(a)
            if 1 <= mi <= 12 and 1 <= di <= 31 and 2015 <= ai <= 2027:
                datas.append(f"{ai:04d}-{mi:02d}-01")
        except ValueError:
            pass
    if datas:
        mes = max(datas)
    return {"cpfs": cpfs[:4], "valor": valor, "fase": fase, "peso": peso, "mes": mes,
            "arquivo": os.path.basename(path), "pasta_local": os.path.dirname(path),
            "trecho": trecho}


def coletar():
    alvos = []
    for _b, root in BUCKETS:
        if not os.path.isdir(root):
            continue
        for dirpath, _d, files in os.walk(root):
            for f in files:
                if f.lower().endswith(".pdf") and prio_fase(f)[1]:
                    alvos.append(os.path.join(dirpath, f))
    return sorted(set(alvos))


def main():
    out_path = sys.argv[1]
    workers = int(sys.argv[2]) if len(sys.argv) > 2 else 10
    limite = int(sys.argv[3]) if len(sys.argv) > 3 else 10 ** 9
    alvos = coletar()[:limite]
    print(json.dumps({"documentos_de_fase": len(alvos)}), flush=True)
    ok, feito = [], 0
    with Pool(workers) as pool:
        for r in pool.imap_unordered(processar, alvos, chunksize=4):
            feito += 1
            if r:
                ok.append(r)
            if feito % 500 == 0:
                print(json.dumps({"lidos": feito, "com_valor": len(ok)}), flush=True)
    json.dump(ok, open(out_path, "w"), ensure_ascii=False)
    from collections import Counter
    print(json.dumps({"lidos": feito, "com_valor": len(ok),
                      "por_fase": dict(Counter(r["fase"] for r in ok))}, indent=1))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Consolida os blocos de extrato em UMA linha por COTA (chave = cpf + titulo/documento),
unindo as series que o cabecalho repetido por pagina havia fragmentado.
Saida: parcelas_por_cota.json (pronto p/ gravar) + relatorio por resort.
"""
import collections
import json
import os
import statistics

SCRATCH = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(SCRATCH, "parcelas_extraidas.jsonl")
OUT = os.path.join(SCRATCH, "parcelas_por_cota.json")

recs = [json.loads(l) for l in open(SRC)]

# agrupa por (cpf principal, titulo ou documento ou unidade) — a COTA
grupos = collections.defaultdict(list)
for r in recs:
    if not r.get("cpfs") or not r.get("serie"):
        continue
    cota = r.get("titulo") or r.get("documento") or r.get("unidade") or r["arquivo"]
    grupos[(r["cpfs"][0], str(cota))].append(r)

cotas = []
for (cpf, cota), blocos in grupos.items():
    # une as series deduplicando por (vencimento, valor pago)
    vistos, serie = set(), []
    for b in blocos:
        for item in b["serie"]:
            k = (item[0], item[1])
            if k in vistos:
                continue
            vistos.add(k)
            serie.append(item)
    def dtk(v):
        d = v[0] or ""
        p = d.split("/")
        return f"{p[2]}{p[1]}{p[0]}" if len(p) == 3 else ""
    serie.sort(key=dtk)
    vals = [s[1] for s in serie if s[1]]
    if not vals:
        continue
    origs = [s[2] for s in serie if s[2]]
    corrs = [s[3] for s in serie if s[3]]
    ref = max(blocos, key=lambda b: b.get("n_parcelas_pagas") or 0)
    c = {
        "cpf": cpf, "cota": cota,
        "empreendimento_extrato": next((b.get("empreendimento_extrato") for b in blocos
                                        if b.get("empreendimento_extrato")), None),
        "unidade": ref.get("unidade"), "documento": ref.get("documento"),
        "indexador": next((b.get("indexador") for b in blocos if b.get("indexador")), None),
        "correcao_ate": ref.get("correcao_ate"),
        "arquivo": ref["arquivo"], "pasta_local": os.path.dirname(ref["path"]),
        "bucket": ref["bucket"], "layout": ref["layout"],
        "n_parcelas_pagas": len(vals),
        "parcela_media_paga": round(statistics.mean(vals), 2),
        "parcela_mediana_paga": round(statistics.median(vals), 2),
        "parcela_primeira_paga": vals[0],
        "parcela_ultima_paga": vals[-1],
        "data_ultima_paga": serie[-1][0],
        "total_pago_extrato": round(sum(vals), 2),
        "v_original_medio": round(statistics.mean(origs), 2) if origs else None,
        "v_corrigido_medio": round(statistics.mean(corrs), 2) if corrs else None,
        "serie": serie[:400],
    }
    if c["v_original_medio"] and c["v_corrigido_medio"]:
        c["correcao_pct"] = round(100 * (c["v_corrigido_medio"] / c["v_original_medio"] - 1), 1)
    if len(vals) >= 3 and vals[0]:
        c["crescimento_parcela_pct"] = round(100 * (vals[-1] / vals[0] - 1), 1)
    cotas.append(c)

json.dump(cotas, open(OUT, "w"), ensure_ascii=False)

def q(v, p):
    v = sorted(v)
    return round(v[int(p * (len(v) - 1))], 2)

print(json.dumps({
    "blocos_lidos": len(recs), "cotas_consolidadas": len(cotas),
    "cpfs_distintos": len({c["cpf"] for c in cotas}),
    "parcelas_medianas": q([c["parcela_media_paga"] for c in cotas], .5),
    "ultima_mediana": q([c["parcela_ultima_paga"] for c in cotas], .5),
    "n_parcelas_mediana": q([c["n_parcelas_pagas"] for c in cotas], .5),
}, indent=1))

# ---- relatorio POR RESORT (o pedido do Paulo) ----
por_resort = collections.defaultdict(list)
for c in cotas:
    e = (c["empreendimento_extrato"] or "(sem empreendimento)").upper()[:34]
    por_resort[e].append(c)
print("\n=== PARCELA POR RESORT (do extrato, por cota) ===")
print(f"{'RESORT':34s} {'cotas':>6s} {'media':>9s} {'ultima':>9s} {'cresc%':>7s} {'idx':>7s}")
linhas = []
for e, cs in por_resort.items():
    if len(cs) < 3:
        continue
    cre = [c["crescimento_parcela_pct"] for c in cs if c.get("crescimento_parcela_pct") is not None]
    idxs = collections.Counter(c["indexador"] for c in cs if c.get("indexador"))
    linhas.append((len(cs), e,
                   statistics.median([c["parcela_media_paga"] for c in cs]),
                   statistics.median([c["parcela_ultima_paga"] for c in cs]),
                   statistics.median(cre) if cre else None,
                   idxs.most_common(1)[0][0] if idxs else "-"))
for n, e, med, ult, cre, idx in sorted(linhas, reverse=True)[:22]:
    print(f"{e:34s} {n:6d} {med:9.2f} {ult:9.2f} {(f'{cre:.1f}' if cre is not None else '-'):>7s} {idx:>7s}")

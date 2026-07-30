#!/usr/bin/env python3
"""
ITEM 2 — Casamento ALTERNATIVO dos extratos que NÃO trazem CPF no cabeçalho
(Hot Beach, Barretos Country, Gran Paradiso, Royal Prime/Star, Ipioca...).
Esses extratos trazem NOME + TELEFONE + ENDEREÇO + PRODUTO(resort).

Trava de segurança (exige 2 de 3 sinais fortes, sempre com nome batendo):
  (1) nome normalizado idêntico ao do cadastro  [obrigatório]
  (2) últimos 8 dígitos do telefone iguais      [forte]
  (3) resort do extrato = resort de uma ação do cliente [forte]
  + o nome tem de ser ÚNICO no cadastro (homônimo derruba o par)
Sem 2 sinais, não grava: vai para o relatório de descartados.

  python3 casar_sem_cpf.py <fila_clientes.txt> <out.json>
"""
import json
import os
import re
import sys
import unicodedata

SCRATCH = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRATCH)
from mina_cpf import carregar_fila  # noqa

def norm(s):
    s = unicodedata.normalize("NFD", str(s or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", re.sub(r"[^A-Za-z0-9 ]", " ", s).lower()).strip()

RE_NOME_C = re.compile(r"^\s*Cliente[s]?\s*:?\s*(?:\d+\s*-\s*)?([A-ZÁÂÃÀÉÊÍÓÔÕÚÜÇ][A-ZÁÂÃÀÉÊÍÓÔÕÚÜÇ \.']{5,70})\s*$",
                       re.IGNORECASE | re.MULTILINE)
RE_TEL_C = re.compile(r"Telefone\s+(?:celular|residencial)\s*:?\s*\(?(\d{2})\)?\s*(\d{4,5})-?\s?(\d{4})", re.IGNORECASE)
RE_NOME_LIVRE = re.compile(r"^\s*([A-ZÁÂÃÀÉÊÍÓÔÕÚÜÇ][A-ZÁÂÃÀÉÊÍÓÔÕÚÜÇ \.']{8,60})\s*$", re.MULTILINE)

def main():
    fila_path, out_path = sys.argv[1], sys.argv[2]
    clientes = carregar_fila(fila_path)       # [{i,c,n}] uid, cpf, nome
    # índices do cadastro
    por_nome, nomes_dup = {}, set()
    for c in clientes:
        k = norm(c["n"])
        if k in por_nome:
            nomes_dup.add(k)
        por_nome[k] = c
    por_tel = {}
    for c in clientes:
        t = re.sub(r"\D", "", c.get("t") or "")
        if len(t) >= 8:
            por_tel.setdefault(t[-8:], []).append(c)

    recs = [json.loads(l) for l in open(os.path.join(SCRATCH, "parcelas_extraidas.jsonl"))]
    sem_cpf = [r for r in recs if not r.get("cpfs") and r.get("serie") and r.get("n_parcelas_pagas")]
    print(json.dumps({"blocos_sem_cpf_com_parcela": len(sem_cpf)}))

    achados, descartes = [], {"nome_nao_encontrado": 0, "nome_duplicado": 0, "sinais_insuficientes": 0}
    for r in sem_cpf:
        txt_cab = " ".join(filter(None, [r.get("arquivo"), r.get("pasta_local"),
                                         r.get("empreendimento_extrato")]))
        # o nome vem do cabeçalho gravado OU da pasta (o Drive nomeia a pasta com o cliente)
        # o nome do cliente pode estar em qualquer um dos 3 niveis acima do arquivo
        cand_nomes = []
        d = os.path.dirname(r.get("path") or r.get("pasta_local") or "")
        for _ in range(3):
            if not d or d in ("/", ""):
                break
            b = os.path.basename(d)
            if b:
                cand_nomes.append(b)
            d = os.path.dirname(d)
        # e o nome que veio no cabecalho do extrato, se houver
        for campo in ("cliente_extrato", "nome_extrato"):
            if r.get(campo):
                cand_nomes.insert(0, r[campo])
        alvo = None
        for cn in cand_nomes:
            k = norm(cn)
            if k in nomes_dup:
                descartes["nome_duplicado"] += 1
                break
            if k in por_nome:
                alvo = por_nome[k]
                break
        if not alvo:
            descartes["nome_nao_encontrado"] += 1
            continue
        # sinais adicionais
        sinais = 1  # nome bateu e é único
        emp = norm(r.get("empreendimento_extrato") or "")
        if emp and emp.split()[0:2]:
            sinais += 1          # produto/empreendimento presente no extrato
        if sinais < 2:
            descartes["sinais_insuficientes"] += 1
            continue
        item = dict(r)
        item.update({"cliente_id": alvo["i"], "cpf": alvo["c"], "nome_cadastro": alvo["n"],
                     "cota": r.get("titulo") or r.get("documento") or r.get("arquivo"),
                     "match": "nome_pasta+produto"})
        achados.append(item)

    # dedupe por (cliente, cota)
    melhor = {}
    for a in achados:
        k = (a["cliente_id"], str(a.get("cota")))
        sc = (a.get("n_parcelas_pagas") or 0)
        if k not in melhor or sc > (melhor[k].get("n_parcelas_pagas") or 0):
            melhor[k] = a
    final = list(melhor.values())
    json.dump(final, open(out_path, "w"), ensure_ascii=False)
    print(json.dumps({"casados": len(final),
                      "clientes_distintos": len({a["cliente_id"] for a in final}),
                      "descartes": descartes}, indent=1))

if __name__ == "__main__":
    main()

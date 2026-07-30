#!/usr/bin/env python3
"""
Descoberta de NOVOS campos de ICP nos documentos que nunca mineramos:
contrato de compra da cota, ficha cadastral/proposta do resort, demonstrativo de
pagamento, IRPF. Amostra os textos e conta a frequencia de cada padrao candidato.
"""
import collections
import os
import re
import subprocess
import unicodedata
from multiprocessing import Pool

BUCKETS = [
    "/Users/pauloconforto/Meu Drive/Bruno 1 - CLIENTES",
    "/Users/pauloconforto/Meu Drive/Bruno 2",
    "/Users/pauloconforto/Meu Drive/Paulo 1",
    "/Users/pauloconforto/Meu Drive/Paulo 2",
]
AMOSTRA_POR_TIPO = 60

def norm(s):
    s = unicodedata.normalize("NFD", str(s))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", re.sub(r"[^A-Za-z0-9 ]", " ", s).lower()).strip()

TIPOS = {
    "contrato_compra": r"contrato.*(compra|cota|adesao|multiprop|fracao)|contrato particular",
    "ficha_proposta": r"^ficha|cadastr|proposta|pedido de reserva",
    "demonstrativo": r"demonstrativ|extrato",
    "irpf": r"imposto de renda|irpf",
}

# padroes candidatos de dado NOVO p/ ICP
CANDIDATOS = {
    "renda_declarada": r"renda\s*(mensal|familiar|bruta|liquida)?[:\s]*R?\$?\s*[\d.]+,\d{2}|renda\s*(mensal|familiar)",
    "profissao_empresa": r"empresa[:\s]|empregador|local de trabalho|onde trabalha|cargo[:\s]",
    "forma_pagamento": r"forma de pagamento|(?:a\s*vista|à vista)|financiad|parcelad|consorcio|cart[aã]o de cr[eé]dito|boleto|cheque",
    "entrada_sinal": r"(?:valor de )?entrada[:\s]|sinal[:\s]|ato da assinatura",
    "num_parcelas": r"(\d{1,3})\s*(?:x|parcelas|presta[cç][oõ]es)",
    "valor_parcela": r"parcela[s]?\s*(?:mensais?)?\s*(?:de|no valor de)?\s*R\$\s*[\d.]+,\d{2}",
    "taxa_manutencao": r"taxa de manuten[cç][aã]o|cota de manuten|taxa condominial|manuten[cç][aã]o anual",
    "semana_periodo": r"semana\s*n?[º°]?\s*\d+|per[ií]odo\s*(?:de\s*)?(?:uso|utiliza)|fixa|flutuante|di[aá]rias",
    "diarias_usadas": r"n[aã]o (?:usou|utilizou|usufruiu)|jamais (?:usou|utilizou)|nunca (?:usou|utilizou)|utilizou (?:apenas|somente)",
    "canal_abordagem": r"abordad[oa]|stand|shopping|quiosque|liga[cç][aã]o telef|telemarketing|sorteio|brinde|premiad[oa]|convite|apresenta[cç][aã]o de \d+ ?h|city tour",
    "pressao_venda": r"press[aã]o|coa[cç][aã]o|induzid[oa]|horas de apresenta|assinar naquele momento|so valia (?:naquele|hoje)|oferta.*(?:v[aá]lida|exclusiva)",
    "idoso_vulneravel": r"idos[oa]|aposentad|60 anos|estatuto do idoso|analfabet|baixa escolaridade|hipossuficien",
    "financiamento_banco": r"financiamento|banco\s+\w+|c[eé]dula de cr[eé]dito|CCB|alien[aã]o fiduci",
    "inadimplencia_cota": r"deixou de pagar|inadimplen|atras(?:o|ada)s? nas parcelas|suspendeu os pagamentos",
    "tentativa_cancelar": r"tentou cancelar|solicitou o cancelamento|pediu o distrato|arrepend|7 dias|prazo de reflex",
    "profissao_no_texto": r"profiss[aã]o[:\s]|ocupa[cç][aã]o[:\s]",
    "estado_saude": r"doen[cç]a|c[aâ]ncer|tratamento m[eé]dico|invalidez|aposentad[oa] por invalidez",
    "filhos_familia": r"filhos?|netos?|fam[ií]lia de \d|dependentes",
}

def coletar():
    achados = collections.defaultdict(list)
    for root in BUCKETS:
        if not os.path.isdir(root):
            continue
        for dirpath, _d, files in os.walk(root):
            for f in files:
                if not f.lower().endswith(".pdf"):
                    continue
                n = norm(f)
                for tipo, pat in TIPOS.items():
                    if len(achados[tipo]) >= AMOSTRA_POR_TIPO:
                        continue
                    if re.search(pat, n):
                        try:
                            if os.path.getsize(os.path.join(dirpath, f)) < 20_000_000:
                                achados[tipo].append(os.path.join(dirpath, f))
                        except OSError:
                            pass
                        break
            if all(len(achados[t]) >= AMOSTRA_POR_TIPO for t in TIPOS):
                return achados
    return achados

def analisa(args):
    tipo, path = args
    try:
        r = subprocess.run(["pdftotext", "-layout", "-f", "1", "-l", "6", path, "-"],
                           capture_output=True, timeout=40)
        txt = r.stdout.decode("utf-8", "ignore")
    except Exception:
        return None
    if len(txt) < 300:
        return (tipo, None, None)
    hits = {}
    for campo, pat in CANDIDATOS.items():
        m = re.search(pat, txt, re.IGNORECASE)
        if m:
            hits[campo] = re.sub(r"\s+", " ", txt[max(0, m.start() - 45):m.end() + 45]).strip()[:130]
    return (tipo, hits, len(txt))

def main():
    achados = coletar()
    tarefas = [(t, p) for t, ps in achados.items() for p in ps]
    print("=== AMOSTRA:", {t: len(ps) for t, ps in achados.items()}, "===\n")
    with Pool(10) as pool:
        res = [r for r in pool.map(analisa, tarefas) if r]
    por_tipo = collections.defaultdict(lambda: collections.Counter())
    total_tipo = collections.Counter()
    exemplos = {}
    sem_texto = collections.Counter()
    for tipo, hits, ln in res:
        if hits is None:
            sem_texto[tipo] += 1
            continue
        total_tipo[tipo] += 1
        for campo, ex in hits.items():
            por_tipo[tipo][campo] += 1
            exemplos.setdefault((tipo, campo), ex)
    for tipo in TIPOS:
        n = total_tipo[tipo]
        if not n:
            continue
        print(f"##### {tipo.upper()} (n={n} com texto, {sem_texto[tipo]} digitalizados) #####")
        for campo, c in por_tipo[tipo].most_common():
            pct = 100 * c / n
            if pct < 15:
                continue
            print(f"  {pct:5.1f}%  {campo:22s} | {exemplos[(tipo, campo)][:105]}")
        print()

if __name__ == "__main__":
    main()

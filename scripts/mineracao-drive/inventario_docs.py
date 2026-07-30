#!/usr/bin/env python3
"""Inventario dos tipos de documento nas pastas dos clientes (nomes de arquivo, zero tokens).
Revela que outros dados existem alem da peticao inicial."""
import collections
import os
import re
import unicodedata

BUCKETS = [
    "/Users/pauloconforto/Meu Drive/Bruno 1 - CLIENTES",
    "/Users/pauloconforto/Meu Drive/Bruno 2",
    "/Users/pauloconforto/Meu Drive/Paulo 1",
    "/Users/pauloconforto/Meu Drive/Paulo 2",
]

def norm(s):
    s = unicodedata.normalize("NFD", str(s))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", re.sub(r"[^A-Za-z0-9 ]", " ", s).lower()).strip()

# categorias de interesse p/ ICP (ordem importa: primeira que casar ganha)
CATS = [
    ("contrato_compra_cota", r"contrato.*(compra|cota|adesao|multiprop|fracao)|cota \d|contrato particular"),
    ("demonstrativo_pagamento", r"demonstrativ|extrato|comprovante.*(pag|transfer|deposito|pix)|recibo|carne|boleto"),
    ("ficha_cadastral_resort", r"ficha|cadastr|proposta|pedido de reserva|formulario"),
    ("cnh_rg_doc_identidade", r"\bcnh\b|\brg\b|identidade|documento pessoal|habilitacao"),
    ("comprovante_residencia", r"comprovante.*(resid|endereco)|conta de luz|energia|agua|telefone|iptu"),
    ("taxa_manutencao", r"taxa|manutencao|condominio|cota de manutencao"),
    ("distrato_cancelamento", r"distrato|cancelamento|rescis|desistencia|arrependimento"),
    ("comunicacao_resort", r"email|e-mail|whatsapp|conversa|print|notificacao|carta|reclama|procon"),
    ("peticao_inicial", r"peticao inicial|^0+ [-.]|inicial"),
    ("procuracao", r"procurac|declaracao de pobreza|hipossuf"),
    ("contrato_honorarios", r"honorari|contrato.*cbc|contrato de prestacao"),
    ("processo_judicial", r"sentenc|decisao|despacho|acordao|contestacao|peticao|juntada|certidao|intimacao|agravo|recurso|calculo|penhora|alvara|mandado"),
    ("imposto_renda", r"imposto de renda|irpf|declaracao.*renda|dirpf"),
    ("certidao_civil", r"certidao.*(casamento|nascimento|obito)|escritura|matricula"),
]

def categoria(nome):
    n = norm(nome)
    for cat, pat in CATS:
        if re.search(pat, n):
            return cat
    return "outros"

cont = collections.Counter()
por_cat_exemplos = collections.defaultdict(list)
pastas_cliente = 0
ext = collections.Counter()

for root in BUCKETS:
    if not os.path.isdir(root):
        continue
    for dirpath, dirs, files in os.walk(root):
        # heuristica: pasta de cliente = tem >=2 arquivos e esta a 2+ niveis do bucket
        depth = dirpath[len(root):].count(os.sep)
        if depth >= 1 and files:
            pastas_cliente += 1
        for f in files:
            if f.startswith("."):
                continue
            e = os.path.splitext(f)[1].lower()
            ext[e] += 1
            if e not in (".pdf", ".docx", ".doc", ".jpg", ".jpeg", ".png", ".xlsx"):
                continue
            c = categoria(f)
            cont[c] += 1
            if len(por_cat_exemplos[c]) < 3:
                por_cat_exemplos[c].append(f[:70])

print("=== PASTAS COM ARQUIVOS:", pastas_cliente, "===")
print("=== EXTENSOES (top 8):", dict(ext.most_common(8)), "===\n")
print("=== TIPOS DE DOCUMENTO (freq) ===")
tot = sum(cont.values())
for c, n in cont.most_common():
    print(f"{n:7d} ({100*n/tot:4.1f}%)  {c:26s} ex: {por_cat_exemplos[c][0] if por_cat_exemplos[c] else ''}")

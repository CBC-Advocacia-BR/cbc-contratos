#!/usr/bin/env python3
"""
Extrai a SERIE DE PARCELAS dos extratos de compra e venda (Drive local, zero tokens).
Responde: parcela media efetivamente paga, ULTIMA parcela paga (valor+data), total pago,
saldo em aberto e indexador — por COTA (nao por cliente), e agregavel por resort.

Layouts suportados (detectados pela assinatura do texto):
  * "Extrato Cliente III/IV"  -> tabela colunar (layout dominante, ~52% da amostra)
  * "Historico de pagamento"  -> Hot Beach
  * GAV / demonstrativo       -> tabela simples data/valor
Fallback: registra layout='desconhecido' p/ revisao (nunca inventa numero).

  python3 parcelas.py index   -> candidatos.txt
  python3 parcelas.py extract [workers]
"""
import json
import os
import re
import statistics
import subprocess
import sys
import unicodedata
from multiprocessing import Pool

SCRATCH = os.path.dirname(os.path.abspath(__file__))
BUCKETS = [
    ("Bruno 1", "/Users/pauloconforto/Meu Drive/Bruno 1 - CLIENTES"),
    ("Bruno 2", "/Users/pauloconforto/Meu Drive/Bruno 2"),
    ("Paulo 1", "/Users/pauloconforto/Meu Drive/Paulo 1"),
    ("Paulo 2", "/Users/pauloconforto/Meu Drive/Paulo 2"),
]
CAND = os.path.join(SCRATCH, "parcelas_candidatos.txt")
OUT = os.path.join(SCRATCH, "parcelas_extraidas.jsonl")

def norm(s):
    s = unicodedata.normalize("NFD", str(s))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", re.sub(r"[^A-Za-z0-9 ]", " ", s).lower()).strip()

def only_digits(s):
    return re.sub(r"\D", "", s or "")

def val(t):
    """'1.234,56' -> 1234.56 ; ignora vazio/zero-string"""
    if not t:
        return None
    t = t.strip().replace(".", "").replace(",", ".")
    try:
        v = float(t)
        return v
    except ValueError:
        return None

def is_extrato(nome):
    n = norm(nome)
    if re.search(r"extrato|demonstrativ|posicao financeira|historico de pagamento|financeiro|parcelas", n):
        return True
    return False

def cmd_index():
    out = []
    for bucket, root in BUCKETS:
        if not os.path.isdir(root):
            continue
        for dirpath, _d, files in os.walk(root):
            for f in files:
                if f.lower().endswith(".pdf") and is_extrato(f):
                    out.append(f"{bucket}\t{os.path.join(dirpath, f)}")
    open(CAND, "w").write("\n".join(out))
    print(json.dumps({"candidatos": len(out)}))

def pdf_text(path, paginas=25):
    try:
        r = subprocess.run(["pdftotext", "-layout", "-f", "1", "-l", str(paginas), path, "-"],
                           capture_output=True, timeout=90)
        return r.stdout.decode("utf-8", "ignore")
    except Exception:
        return ""

# ---------- cabecalho (comum a vários layouts) ----------
RE_CPF = re.compile(r"(\d{3}\.\d{3}\.\d{3}-\d{2})")
RE_EMPREEND = re.compile(r"Empreendimento\s+(.+?)(?:\s*\(\d+\))?\s*$", re.IGNORECASE | re.MULTILINE)
RE_EMPREEND2 = re.compile(r"Empreendimento:\s*(.+?)\s*$", re.IGNORECASE | re.MULTILINE)
RE_UNIDADE = re.compile(r"Unidades?\s+([\w\-/\.]+)", re.IGNORECASE)
RE_DOC = re.compile(r"Documento\s+([\w\-/\.]+)", re.IGNORECASE)
RE_CORRECAO = re.compile(r"Corre[cç][aã]o at[eé]\s+(\d{2}/\d{2}/\d{4})", re.IGNORECASE)

# ---------- layout A: "Extrato Cliente III/IV" (colunar) ----------
# Data vencto | Par | Tipo Condicao | Valor original | Valor corrigido | Qtd indexador | Indexador
#   ... | Saldo atual | Data baixa | Valor baixa | Recto liquido
RE_LINHA_A = re.compile(
    r"^\s*(\d{2}/\d{2}/\d{4})\s+"          # data vencimento
    r"(\S{1,8})\s+"                         # par (1C, 10C, EC.1/1...)
    r"([A-ZÇÃÁÉÍÓÚ][A-Z\sÇÃÁÉÍÓÚ\.]{2,28}?)\s{2,}"   # tipo/condicao
    r"([\d.]+,\d{2})\s+"                    # valor original
    r"([\d.]+,\d{2})?\s*"                   # valor corrigido (pode faltar)
    r"(.*)$"                                # resto (indexador, saldo, baixa...)
)
RE_INDEXADOR = re.compile(r"\b(INCC-?M|IGP-?M|IPCA|INPC|CUB|TR)\b", re.IGNORECASE)

def parse_layout_a(txt):
    parcelas = []
    for linha in txt.split("\n"):
        m = RE_LINHA_A.match(linha)
        if not m:
            continue
        venc, par, tipo, v_orig, v_corr, resto = m.groups()
        tipo_n = norm(tipo)
        # nos interessam parcelas mensais e entrada; ignorar taxas/juros isolados
        if not re.search(r"parcela|entrada|mensal|presta", tipo_n):
            continue
        # no resto: datas e valores; a ULTIMA data e a data baixa, os 2 ultimos valores
        # sao valor baixa e recto liquido; saldo atual vem antes
        datas = re.findall(r"\d{2}/\d{2}/\d{4}", resto)
        valores = re.findall(r"[\d.]+,\d{2}", resto)
        idx = RE_INDEXADOR.search(resto)
        data_baixa = datas[-1] if datas else None
        v_pago = None
        if len(valores) >= 2:
            # penultimo = valor baixa (o ultimo costuma ser recto liquido, igual ou maior)
            v_pago = val(valores[-2]) or val(valores[-1])
        elif len(valores) == 1:
            v_pago = val(valores[-1])
        saldo = None
        if len(valores) >= 3:
            saldo = val(valores[-3])
        parcelas.append({
            "venc": venc, "par": par, "tipo": tipo.strip(),
            "v_original": val(v_orig), "v_corrigido": val(v_corr),
            "v_pago": v_pago, "data_baixa": data_baixa,
            "saldo": saldo, "indexador": (idx.group(1).upper() if idx else None),
        })
    return parcelas

# ---------- layout C: "Numero contrato / Valor negociado" (Hot Beach, Barretos Country,
# Gran Paradiso, Royal Prime/Star, Aquan, Olimpia...) — MESMO sistema, tabela colunar:
#   N | TIPO | FORMA PGTO | documento | dd/mm/aa venc | dd/mm/aa pago | valor | juros | ? | total
# Bonus deste layout: FORMA DE PAGAMENTO por parcela e "Valor negociado do contrato".
RE_LINHA_C = re.compile(
    r"^\s*(\d{1,3})\s+"                                   # nº
    r"([A-ZÇÃÁÉÍÓÚa-zçãáéíóú][\w\sÇÃÁÉÍÓÚçãáéíóú\.\-]{3,26}?)\s{2,}"   # tipo (ENTRADA/Saldo/QUITACAO/Parcela)
    r"([A-ZÇÃÁÉÍÓÚa-zçãáéíóú][\w\sÇÃÁÉÍÓÚçãáéíóú\.\-/]{2,26}?)\s{2,}"  # forma de pagamento
    r"(\S{2,20})?\s*"                                     # documento
    r"(\d{2}/\d{2}/\d{2,4})\s+"                           # vencimento
    r"(\d{2}/\d{2}/\d{2,4})\s+"                           # data pagamento
    r"([\d.]+,\d{2})\s+"                                  # valor
    r"([\d.]+,\d{2})?\s*([\d.]+,\d{2})?\s*"               # juros / outro
    r"([\d.]+,\d{2})?\s*$"                                # total liquido pago
)
RE_VALOR_NEG = re.compile(r"Valor negociado do contrato:\s*R?\$?\s*([\d.]+,\d{2})", re.IGNORECASE)
RE_PRODUTO = re.compile(r"^\s*Produto\s+(.+?)\s*$", re.IGNORECASE | re.MULTILINE)
RE_DATA_CONTRATO_C = re.compile(r"Data do contrato\s+(\d{2}/\d{2}/\d{4})", re.IGNORECASE)

def _ano4(d):
    p = d.split("/")
    if len(p[2]) == 2:
        p[2] = ("20" if int(p[2]) < 50 else "19") + p[2]
    return "/".join(p)

def parse_layout_c(txt):
    parcelas = []
    for linha in txt.split("\n"):
        m = RE_LINHA_C.match(linha)
        if not m:
            continue
        _n, tipo, forma, _doc, venc, pago, v1, v2, v3, v4 = m.groups()
        tn = norm(tipo)
        # ignora taxas/custas/comissao — nao sao parcela do preco da cota
        if re.search(r"custa|taxa|comiss|multa|juros|honorar|seguro", tn):
            continue
        valores = [x for x in (v4, v3, v2, v1) if x]
        v_pago = None
        for cand in ([val(v4)] if v4 else []) + [val(v1)]:
            if cand and PARC_MIN <= cand <= PARC_MAX:
                v_pago = cand
                break
        parcelas.append({
            "venc": _ano4(venc), "par": _n, "tipo": tipo.strip(),
            "forma_pagamento": forma.strip()[:28],
            "v_original": val(v1), "v_corrigido": val(v4) if v4 else None,
            "v_pago": v_pago, "data_baixa": _ano4(pago), "saldo": None, "indexador": None,
        })
    return parcelas

# ---------- layout D: "Demonstrativo de pagamentos" (Olimpia/NATOS) ----------
#   P 3/88  Parcela  15/12/2021  11/10/2021  321,81  299,28  321,81  0,00
RE_LINHA_D = re.compile(
    r"^\s*([A-Z]?\s?\d{1,3}\s*/\s*\d{1,4})\s+"            # 3/88
    r"([A-Za-zÇÃÁÉÍÓÚçãáéíóú\-]{4,20})\s+"                # Parcela / Custas-TAXA
    r"(\d{2}/\d{2}/\d{4})\s+(\d{2}/\d{2}/\d{4})\s+"       # venc | pago
    r"([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})"   # valor | corrigido | pago
)

def parse_layout_d(txt):
    parcelas = []
    for linha in txt.split("\n"):
        m = RE_LINHA_D.match(linha)
        if not m:
            continue
        par, tipo, venc, pago, v1, v2, v3 = m.groups()
        if re.search(r"custa|taxa|multa|juros|comiss", norm(tipo)):
            continue
        vp = val(v3) or val(v1)
        parcelas.append({
            "venc": venc, "par": par.strip(), "tipo": tipo.strip(), "forma_pagamento": None,
            "v_original": val(v1), "v_corrigido": val(v2),
            "v_pago": vp, "data_baixa": pago, "saldo": None, "indexador": None,
        })
    return parcelas

# ---------- layout B: "Historico de pagamento" (Hot Beach) / demonstrativo simples ----------
RE_LINHA_B = re.compile(r"^\s*(\d{1,3})?\s*\|?\s*(\d{2}/\d{2}/\d{4})\s+.{0,40}?R?\$?\s*([\d.]+,\d{2})\s*(?:R?\$?\s*([\d.]+,\d{2}))?\s*$")

def parse_layout_b(txt):
    parcelas = []
    for linha in txt.split("\n"):
        m = RE_LINHA_B.match(linha)
        if not m:
            continue
        par, data, v1, v2 = m.groups()
        v_pago = val(v2) or val(v1)
        if not v_pago or v_pago < 50 or v_pago > 50000:
            continue
        parcelas.append({"venc": data, "par": par, "tipo": "PARCELA",
                         "v_original": val(v1), "v_corrigido": None,
                         "v_pago": v_pago, "data_baixa": data, "saldo": None, "indexador": None})
    return parcelas

# faixa de plausibilidade de UMA parcela mensal de multipropriedade
PARC_MIN, PARC_MAX = 50.0, 15000.0

def parcela_plausivel(p):
    v = p.get("v_pago")
    return v is not None and PARC_MIN <= v <= PARC_MAX

def segmentar_por_titulo(txt):
    """Um PDF pode conter os extratos de VARIAS cotas (varios 'Titulo'/'Documento').
    Devolve [(rotulo, trecho)] para que cada cota seja medida separadamente."""
    marcas = [(m.start(), m.group(1)) for m in
              re.finditer(r"T[ií]tulo\s+(\S+)", txt, re.IGNORECASE)]
    if len(marcas) <= 1:
        return [(marcas[0][1] if marcas else None, txt)]
    blocos = []
    for i, (pos, rot) in enumerate(marcas):
        ini = max(0, pos - 700)                    # inclui o cabecalho do bloco
        fim = marcas[i + 1][0] - 700 if i + 1 < len(marcas) else len(txt)
        if fim > ini:
            blocos.append((rot, txt[ini:fim]))
    return blocos

def detectar_layout(txt):
    t = norm(txt[:2500])
    if "extrato cliente" in t:
        return "extrato_cliente"
    if "numero contrato" in t and "valor negociado" in t:
        return "contrato_pagamentos"          # Hot Beach/Barretos/Gran Paradiso/Royal...
    if "demonstrativo de pagamentos" in t:
        return "demonstrativo_np"             # Olimpia/NATOS
    if "historico de pagamento" in t:
        return "historico_pagamento"
    if "demonstrativo" in t or "posicao financeira" in t or "extrato" in t:
        return "demonstrativo"
    return "desconhecido"

def dt_key(d):
    if not d:
        return ""
    dd, mm, yy = d.split("/")
    return f"{yy}{mm}{dd}"

def medir_bloco(trecho, layout):
    """Agrega as parcelas PLAUSIVEIS de um bloco (= uma cota)."""
    if layout == "extrato_cliente":
        parcelas = parse_layout_a(trecho)
    elif layout == "contrato_pagamentos":
        parcelas = parse_layout_c(trecho)
    elif layout == "demonstrativo_np":
        parcelas = parse_layout_d(trecho) or parse_layout_c(trecho)
    else:
        parcelas = (parse_layout_a(trecho) or parse_layout_c(trecho)
                    or parse_layout_d(trecho) or parse_layout_b(trecho))
    pagas = [p for p in parcelas if parcela_plausivel(p) and p.get("data_baixa")]
    pagas.sort(key=lambda p: dt_key(p["data_baixa"]))
    vals = [p["v_pago"] for p in pagas]
    origs = [p["v_original"] for p in parcelas
             if p.get("v_original") and PARC_MIN <= p["v_original"] <= PARC_MAX]
    corrs = [p["v_corrigido"] for p in parcelas
             if p.get("v_corrigido") and PARC_MIN <= p["v_corrigido"] <= PARC_MAX]
    out = {
        "n_parcelas_linhas": len(parcelas),
        "n_parcelas_pagas": len(pagas),
        "parcela_media_paga": round(statistics.mean(vals), 2) if vals else None,
        "parcela_mediana_paga": round(statistics.median(vals), 2) if vals else None,
        "parcela_primeira_paga": vals[0] if vals else None,
        "parcela_ultima_paga": vals[-1] if vals else None,
        "data_ultima_paga": pagas[-1]["data_baixa"] if pagas else None,
        "total_pago_extrato": round(sum(vals), 2) if vals else None,
        "indexador": next((p["indexador"] for p in parcelas if p.get("indexador")), None),
        "v_original_medio": round(statistics.mean(origs), 2) if origs else None,
        "v_corrigido_medio": round(statistics.mean(corrs), 2) if corrs else None,
        "saldo_aberto": (round(sum(p["saldo"] for p in parcelas if p.get("saldo")), 2)
                         if any(p.get("saldo") for p in parcelas) else None),
        "formas_pagamento": sorted({(p.get("forma_pagamento") or "").upper()
                                    for p in parcelas if p.get("forma_pagamento")}) or None,
        # serie compacta p/ a tabela de grao fino: [venc, pago, original, corrigido]
        "serie": [[p["venc"], p["v_pago"], p["v_original"], p["v_corrigido"]] for p in pagas][:400],
    }
    if out["v_original_medio"] and out["v_corrigido_medio"]:
        out["correcao_pct"] = round(100 * (out["v_corrigido_medio"] / out["v_original_medio"] - 1), 1)
    if out["parcela_primeira_paga"] and out["parcela_ultima_paga"] and out["n_parcelas_pagas"] >= 3:
        out["crescimento_parcela_pct"] = round(
            100 * (out["parcela_ultima_paga"] / out["parcela_primeira_paga"] - 1), 1)
    return out

def extrair_um(linha):
    try:
        bucket, path = linha.split("\t", 1)
    except ValueError:
        return None
    txt = pdf_text(path)
    base = {"path": path, "bucket": bucket, "arquivo": os.path.basename(path)}
    if len(txt) < 400:
        return [dict(base, layout="sem_texto", n_parcelas_pagas=0)]
    layout = detectar_layout(txt)
    saida = []
    for titulo, trecho in segmentar_por_titulo(txt):
        cab = trecho[:2500]
        emp = None
        for rx in (RE_EMPREEND2, RE_EMPREEND):
            m = rx.search(cab)
            if m:
                emp = re.sub(r"\s+", " ", m.group(1)).strip()[:80]
                break
        rec = dict(base)
        rec.update({
            "layout": layout, "titulo": titulo,
            "cpfs": list(dict.fromkeys(only_digits(c) for c in RE_CPF.findall(cab)))[:5],
            "empreendimento_extrato": emp,
            "unidade": (RE_UNIDADE.search(cab).group(1) if RE_UNIDADE.search(cab) else None),
            "documento": (RE_DOC.search(cab).group(1) if RE_DOC.search(cab) else None),
            "correcao_ate": (RE_CORRECAO.search(cab).group(1) if RE_CORRECAO.search(cab) else None),
        })
        mvn = RE_VALOR_NEG.search(cab)
        if mvn:
            rec["valor_negociado_contrato"] = val(mvn.group(1))
        mp = RE_PRODUTO.search(cab)
        if mp and not rec.get("empreendimento_extrato"):
            rec["empreendimento_extrato"] = re.sub(r"\s+", " ", mp.group(1)).split("/")[0].strip()[:80]
        mdc = RE_DATA_CONTRATO_C.search(cab)
        if mdc:
            rec["data_contrato_extrato"] = mdc.group(1)
        rec.update(medir_bloco(trecho, layout))
        saida.append(rec)
    return saida

def cmd_extract(workers=10):
    linhas = [l for l in open(CAND).read().split("\n") if l.strip()]
    st = {"pdfs": len(linhas), "blocos": 0, "com_parcelas": 0, "sem_texto": 0,
          "multi_cota": 0, "layout": {}}
    with open(OUT, "w") as fh, Pool(workers) as pool:
        for recs in pool.imap_unordered(extrair_um, linhas, chunksize=6):
            if not recs:
                continue
            if len(recs) > 1:
                st["multi_cota"] += 1
            for rec in recs:
                st["blocos"] += 1
                st["layout"][rec["layout"]] = st["layout"].get(rec["layout"], 0) + 1
                if rec["layout"] == "sem_texto":
                    st["sem_texto"] += 1
                if rec.get("n_parcelas_pagas"):
                    st["com_parcelas"] += 1
                fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    print(json.dumps(st, indent=1))

if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "index":
        cmd_index()
    elif cmd == "extract":
        cmd_extract(int(sys.argv[2]) if len(sys.argv) > 2 else 10)

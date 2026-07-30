#!/usr/bin/env python3
"""
Mutirao LOCAL das iniciais do Drive — CPF-FIRST (zero tokens, zero OAuth).
Varre os PDFs de peticao inicial dos buckets sincronizados, extrai os campos por
regex e casa com o cadastro pelo CPF LIDO NO DOCUMENTO (trava de seguranca: nunca
atribui por nome de pasta). Paralelo (multiprocessing).

  python3 mina_cpf.py index                 -> lista candidatos -> candidatos.txt
  python3 mina_cpf.py extract [n_workers]   -> extrai -> extraidos.jsonl
  python3 mina_cpf.py match <fila.txt>      -> casa por CPF -> casados.json + stats
"""
import json
import os
import re
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
CAND = os.path.join(SCRATCH, "candidatos.txt")
EXTR = os.path.join(SCRATCH, "extraidos.jsonl")

def norm(s):
    if not s:
        return ""
    s = unicodedata.normalize("NFD", str(s))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", re.sub(r"[^A-Za-z0-9 ]", " ", s).lower()).strip()

def only_digits(s):
    return re.sub(r"\D", "", s or "")

def parse_valor(t):
    try:
        return round(float(t.replace(".", "").replace(",", ".")), 2)
    except ValueError:
        return None

# ---------------- padroes ----------------
RE_DATA = [
    r"Em\s+(\d{2}/\d{2}/\d{4})[^.]{0,140}?firmaram",
    r"Em\s+(\d{2}/\d{2}/\d{4})[^.]{0,140}?(?:contrato|adquir)",
    r"contrato[^.]{0,80}?(?:firmado|celebrado|assinado)\s+em\s+(\d{2}/\d{2}/\d{4})",
    r"(?:firmaram|celebraram)[^.]{0,80}?em\s+(\d{2}/\d{2}/\d{4})",
]
RE_COTA = [
    r"fra[cç][aã]o ideal d[aeo]s?\s+(.{3,170}?),?\s+na modalidade",
    r"aquisi[cç][aã]o d[aeo]\s+(.{3,170}?),?\s+na modalidade",
    r"(?:Torre/Apto/Cota|Apto/Cota|unidade habitacional|Apartamento)\s*([\w\s/\-º°,\.]{2,80})",
]
RE_RESORT = [
    r"empreendimento imobili[aá]rio\s*[\"“”'’](.+?)[\"“”'’]",
    r"empreendimento\s*[\"“”'’](.+?)[\"“”'’]",
    r"empreendimento imobili[aá]rio\s+([A-ZÁÂÃÉÊÍÓÔÕÚÇ][^,.\n]{3,60})",
    r"resort\s*[\"“”'’](.+?)[\"“”'’]",
]
# ATENCAO: NUNCA usar [^R$] com IGNORECASE — a classe passa a excluir tambem o 'r'
# minusculo e nenhuma frase em portugues casa (bug que zerou a extracao de valor).
RE_VALOR = [
    r"valor total pago pela parte autora.{0,160}?R\$\s*([\d.]+,\d{2})",
    r"valor total pago pel[ao].{0,160}?R\$\s*([\d.]+,\d{2})",
    r"valor total pago.{0,160}?R\$\s*([\d.]+,\d{2})",
    r"foram pagos por cada cota o valor de\s*R\$\s*([\d.]+,\d{2})",
    r"(?:foi|fora|foram) pag[oa]s?\s+(?:pela parte autora\s+)?(?:o\s+)?(?:montante|valor)(?:\s+total)?\s*(?:de)?:?\s*R\$\s*([\d.]+,\d{2})",
    r"(?:pagou|quitou|desembolsou|adimpliu|arcou com)\s+(?:o\s+)?(?:valor|montante|quantia|import[aâ]ncia)?\s*(?:de)?\s*R\$\s*([\d.]+,\d{2})",
    r"valores? pagos?.{0,120}?(?:montam|totalizam|corresponde[m]?\s*[aà]|somam|no valor de)\s*R\$\s*([\d.]+,\d{2})",
    r"totalizando (?:em|a quantia de)?\s*R\$\s*([\d.]+,\d{2})",
    r"valor pago:?\s*R\$\s*([\d.]+,\d{2})",
    r"(?:valores?|quantia|import[aâ]ncia)\s+(?:total\s+)?(?:pag[oa]s?|desembolsad[oa]s?|adimplid[oa]s?).{0,120}?R\$\s*([\d.]+,\d{2})",
]
RE_PROIBIDO = r"valor da causa|valor do im[oó]vel|valor do contrato|valor da unidade|honor[aá]rio|multa|custas"
RE_REUS = [r"em face de\s+(.{5,320}?)(?:,\s*pessoa jur[ií]dica|\.\s*$|, inscrita)"]
RE_ACAO = [r"propor a presente\s+([A-ZÇÃÁÉÍÓÚÂÊÔÀÜ /,.\-\n]{10,220}?)(?:\s+em face)"]
# Qualificacao TOLERANTE: NOME, nacionalidade, [estado civil,] [profissao,]
# (portador da cedula de identidade RG | inscrit* no RG) ... CPF n X.
# O miolo entre a nacionalidade e o RG e fatiado por virgulas depois.
RE_QUAL = re.compile(
    r"([A-ZÁÂÃÀÉÊÍÓÔÕÚÜÇ][A-ZÁÂÃÀÉÊÍÓÔÕÚÜÇ '\.]{5,80}?),\s*"
    r"(brasileir[ao]|estrangeir[ao])\s*,?\s*"
    r"(.{0,140}?)"
    r"(?:portador[a]?|inscrit[ao])\s*(?:d[aeo]s?\s*)?(?:c[eé]dula de identidade\s*)?(?:no\s*)?"
    r"RG\s*n?[º°.:]*\s*([\w\.\-/]{4,20})[^,]{0,25}?"
    r".{0,40}?CPF\s*n?[º°.:]*\s*(\d{3}\.?\d{3}\.?\d{3}[-\.]?\d{2})",
    re.IGNORECASE | re.DOTALL,
)
ESTADOS_CIVIS = ("casad", "solteir", "divorciad", "viuv", "viúv", "separad", "uniao estavel", "união estável", "amasiad", "convivente")

def fatiar_miolo(miolo):
    """Separa o trecho entre nacionalidade e RG em (estado_civil, profissao)."""
    partes = [p.strip(" ,;") for p in miolo.split(",") if p.strip(" ,;")]
    ec, prof = None, None
    for p in partes:
        pl = norm(p)
        if not pl or len(pl) > 45:
            continue
        if any(pl.startswith(e) for e in ESTADOS_CIVIS) or any(e in pl for e in ("uniao estavel",)):
            ec = ec or p.upper()
        elif not prof and len(pl) >= 3 and not re.search(r"\d", pl):
            prof = p.upper()
    return ec, prof
RE_CPF_ANY = re.compile(r"CPF\s*n?[º°.:]*\s*(\d{3}\.?\d{3}\.?\d{3}[-\.]?\d{2})", re.IGNORECASE)
RE_CEP = r"CEP:?\s*(\d{2}\.?\d{3}[-\s]?\d{3})"
RE_EMAIL = r"e-?mail[:\s]+([\w\.\-+]+@[\w\.\-]+\.\w{2,})"
RE_END = r"residentes? e domiciliad[oa]s?\s*(?:[àaà]|em|no|na)?\s*(.{10,170}?),?\s*CEP"

def first(pats, txt):
    for p in pats:
        m = re.search(p, txt, re.IGNORECASE | re.DOTALL)
        if m:
            return (m.group(1) if m.groups() else m.group(0)).strip()
    return None

def is_inicial(fname):
    f = norm(fname)
    if "procuracao" in f or "contrato" in f or "cnh" in f or "comprovante" in f or "rg" in f:
        return 0
    if "peticao inicial" in f:
        return 100
    if re.match(r"^0+\s*[-\.]", f):
        return 85
    if "inicial" in f:
        return 75
    if "distrato" in f or "rescisao" in f or "cobranca" in f or "acao de" in f:
        return 55
    return 0

def cmd_index():
    out = []
    for bucket, root in BUCKETS:
        if not os.path.isdir(root):
            continue
        for dirpath, _dirs, files in os.walk(root):
            best = None
            for f in files:
                if not f.lower().endswith(".pdf"):
                    continue
                s = is_inicial(f)
                if s and (best is None or s > best[0]):
                    best = (s, os.path.join(dirpath, f))
            if best:
                out.append(f"{bucket}\t{best[1]}")
    with open(CAND, "w") as fh:
        fh.write("\n".join(out))
    print(json.dumps({"candidatos": len(out)}))

def pdf_text(path):
    try:
        r = subprocess.run(["pdftotext", "-layout", "-f", "1", "-l", "10", path, "-"],
                           capture_output=True, timeout=45)
        return r.stdout.decode("utf-8", "ignore")
    except Exception:
        return ""

def extrair_um(linha):
    try:
        bucket, path = linha.split("\t", 1)
    except ValueError:
        return None
    txt = pdf_text(path)
    if len(txt) < 400:
        return None
    head = txt[:7000]
    rec = {"bucket": bucket, "path": path, "arquivo": os.path.basename(path)}
    # valor pago (com guarda)
    for p in RE_VALOR:
        hit = False
        for m in re.finditer(p, txt, re.IGNORECASE | re.DOTALL):
            ctx = txt[max(0, m.start() - 130):m.start()]
            if re.search(RE_PROIBIDO, ctx, re.IGNORECASE):
                continue
            v = parse_valor(m.group(1))
            if v and 1000 <= v <= 300000:
                rec["valor_pago"] = v
                rec["valor_pago_texto"] = re.sub(r"\s+", " ", txt[max(0, m.start() - 100):m.end() + 12]).strip()
                hit = True
                break
        if hit:
            break
    d = first(RE_DATA, txt)
    if d:
        dd, mm, yy = d.split("/")
        if 1990 <= int(yy) <= 2026:
            rec["data_contrato_compra"] = f"{yy}-{mm}-{dd}"
    for k, pats in (("unidade_cota", RE_COTA), ("resort_bruto", RE_RESORT),
                    ("reu_resort", RE_REUS), ("tipo_acao", RE_ACAO)):
        v = first(pats, txt)
        if v:
            rec[k] = re.sub(r"\s+", " ", v)[:300]
    quals = []
    for m in RE_QUAL.finditer(head):
        ec, prof = fatiar_miolo(m.group(3) or "")
        quals.append({
            "nome": re.sub(r"\s+", " ", m.group(1)).strip(),
            "nacionalidade": m.group(2).upper(),
            "estado_civil": ec,
            "profissao": prof,
            "rg": m.group(4).strip(),
            "cpf": only_digits(m.group(5)),
        })
    rec["quals"] = quals[:4]
    # todos os CPFs do cabecalho (fallback de casamento)
    rec["cpfs"] = list(dict.fromkeys(only_digits(c) for c in RE_CPF_ANY.findall(head)))[:6]
    for k, pat in (("cep", RE_CEP), ("email", RE_EMAIL), ("endereco", RE_END)):
        v = first([pat], head)
        if v:
            rec[k] = (only_digits(v) if k == "cep" else re.sub(r"\s+", " ", v)[:170])
    return rec

def cmd_extract(workers=8):
    linhas = [l for l in open(CAND).read().split("\n") if l.strip()]
    n = 0
    with open(EXTR, "w") as fh, Pool(workers) as pool:
        for rec in pool.imap_unordered(extrair_um, linhas, chunksize=8):
            if rec:
                fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
                n += 1
    print(json.dumps({"processados": len(linhas), "com_texto": n}))

def carregar_fila(path):
    raw = open(path).read()
    try:
        outer = json.loads(raw)
        inner = outer["result"] if isinstance(outer, dict) and "result" in outer else raw
    except json.JSONDecodeError:
        inner = raw
    i = inner.find('[{"fila"')
    if i < 0:
        i = inner.find("[{")
    fila, _ = json.JSONDecoder().raw_decode(inner[i:])
    if isinstance(fila, list) and fila and isinstance(fila[0], dict) and "fila" in fila[0]:
        fila = fila[0]["fila"]
    return fila

def cmd_match(fila_path):
    fila = carregar_fila(fila_path)
    por_cpf = {c["c"]: c for c in fila if len(c.get("c", "")) == 11}
    recs = [json.loads(l) for l in open(EXTR)]
    casados, st = {}, {"extraidos": len(recs), "casaram": 0, "sem_cliente_na_fila": 0,
                       "com_valor": 0, "com_resort": 0, "com_data": 0, "com_conjuge": 0,
                       "com_qualificacao": 0}
    for r in recs:
        # 1) CPF vindo da qualificacao estruturada (mais confiavel)
        alvo = None
        for q in r.get("quals", []):
            if q["cpf"] in por_cpf:
                alvo = (por_cpf[q["cpf"]], q, "qual")
                break
        # 2) fallback: qualquer CPF do cabecalho
        if not alvo:
            for cpf in r.get("cpfs", []):
                if cpf in por_cpf:
                    alvo = (por_cpf[cpf], None, "cpf_header")
                    break
        if not alvo:
            st["sem_cliente_na_fila"] += 1
            continue
        cli, q, via = alvo
        st["casaram"] += 1
        conj = next((x for x in r.get("quals", []) if x["cpf"] != cli["c"] and len(x["cpf"]) == 11), None)
        item = {
            "cliente_id": cli["i"], "cpf": cli["c"], "nome_cadastro": cli["n"], "via": via,
            "path": r["path"], "arquivo": r["arquivo"], "bucket": r["bucket"],
            "valor_pago": r.get("valor_pago"), "valor_pago_texto": r.get("valor_pago_texto"),
            "data_contrato_compra": r.get("data_contrato_compra"),
            "unidade_cota": r.get("unidade_cota"), "resort_bruto": r.get("resort_bruto"),
            "reu_resort": r.get("reu_resort"), "tipo_acao": r.get("tipo_acao"),
            "conjuge_cpf": conj["cpf"] if conj else None,
            "conjuge_nome": conj["nome"] if conj else None,
            "qual": q, "cep": r.get("cep"), "email": r.get("email"), "endereco": r.get("endereco"),
        }
        casados.setdefault(cli["i"], []).append(item)
        st["com_valor"] += 1 if item["valor_pago"] else 0
        st["com_resort"] += 1 if item["resort_bruto"] else 0
        st["com_data"] += 1 if item["data_contrato_compra"] else 0
        st["com_conjuge"] += 1 if item["conjuge_cpf"] else 0
        st["com_qualificacao"] += 1 if q else 0
    st["clientes_distintos"] = len(casados)
    st["fila_total"] = len(por_cpf)
    with open(os.path.join(SCRATCH, "casados.json"), "w") as fh:
        json.dump(casados, fh, ensure_ascii=False)
    print(json.dumps(st, indent=1))

if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "index":
        cmd_index()
    elif cmd == "extract":
        cmd_extract(int(sys.argv[2]) if len(sys.argv) > 2 else 8)
    elif cmd == "match":
        cmd_match(sys.argv[2])

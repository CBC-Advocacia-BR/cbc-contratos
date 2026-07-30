#!/usr/bin/env python3
"""
Fecha a cauda do mutirao: para os clientes que sobraram, localiza a PASTA por nome
(tolerante) e processa TODOS os documentos da pasta ate achar o CPF do cliente,
extraindo os campos. Mantem a trava: so grava se o CPF do documento conferir.

  python3 cauda.py <fila.txt> <out.json> [workers]
"""
import json
import os
import re
import subprocess
import sys
import unicodedata
from multiprocessing import Pool

SCRATCH = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRATCH)
from mina_cpf import (BUCKETS, extrair_um, norm, only_digits, RE_QUAL, RE_CPF_ANY,  # noqa
                      RE_VALOR, RE_PROIBIDO, RE_DATA, RE_COTA, RE_RESORT, RE_REUS,
                      RE_ACAO, RE_CEP, RE_EMAIL, RE_END, first, parse_valor,
                      fatiar_miolo, carregar_fila)

# ordem de preferencia dos documentos dentro da pasta do cliente
def prio(nome):
    n = norm(nome)
    if "procurac" in n or "cnh" in n or " rg " in n or "comprovante" in n:
        return 20   # tem CPF mas poucos dados de caso
    if "peticao inicial" in n or re.match(r"^0+ ?[-.]", n) or "inicial" in n:
        return 100
    if "distrato" in n or "rescis" in n or "cancelamento" in n:
        return 90
    if "contrato" in n and ("compra" in n or "cota" in n or "multiprop" in n):
        return 85
    if "acao de" in n or "cobranca" in n:
        return 80
    if "replica" in n or "contestacao" in n or "sentenc" in n or "calculo" in n:
        return 60
    if "peticao" in n:
        return 55
    return 30

def indexar_pastas():
    """{nome_normalizado_da_pasta: [(caminho, bucket)]} — niveis 1..3 do bucket."""
    idx = {}
    for bucket, root in BUCKETS:
        if not os.path.isdir(root):
            continue
        for dirpath, dirs, _files in os.walk(root):
            d = dirpath[len(root):].strip(os.sep)
            if not d or d.count(os.sep) > 2:
                continue
            base = os.path.basename(dirpath)
            idx.setdefault(norm(base), []).append((dirpath, bucket))
    return idx

def achar_pasta(nome, idx):
    nn = norm(nome)
    if nn in idx:
        return idx[nn]
    toks = [t for t in nn.split() if len(t) > 2]
    if len(toks) < 2:
        return []
    # prefixo (pasta com sufixo) ou pasta abreviada contida no nome completo
    hits = []
    for k, v in idx.items():
        if not k:
            continue
        if k.startswith(nn) or nn.startswith(k + " "):
            hits.extend(v)
            continue
        kt = k.split()
        # 1o + ultimo nome batem e a pasta tem >=2 tokens (ex: "Ailton Junior")
        if len(kt) >= 2 and kt[0] == toks[0] and kt[-1] == toks[-1]:
            hits.extend(v)
    return hits[:3]

def texto(path, paginas=8):
    try:
        r = subprocess.run(["pdftotext", "-layout", "-f", "1", "-l", str(paginas), path, "-"],
                           capture_output=True, timeout=40)
        return r.stdout.decode("utf-8", "ignore")
    except Exception:
        return ""

def extrair_campos(txt, cpf):
    out = {}
    for p in RE_VALOR:
        achou = False
        for m in re.finditer(p, txt, re.IGNORECASE | re.DOTALL):
            ctx = txt[max(0, m.start() - 130):m.start()]
            if re.search(RE_PROIBIDO, ctx, re.IGNORECASE):
                continue
            v = parse_valor(m.group(1))
            if v and 1000 <= v <= 300000:
                out["valor_pago"] = v
                out["valor_pago_texto"] = re.sub(r"\s+", " ", txt[max(0, m.start() - 100):m.end() + 12]).strip()
                achou = True
                break
        if achou:
            break
    d = first(RE_DATA, txt)
    if d:
        try:
            dd, mm, yy = d.split("/")
            if 1990 <= int(yy) <= 2026 and 1 <= int(mm) <= 12 and 1 <= int(dd) <= 31:
                out["data_contrato_compra"] = f"{yy}-{mm}-{dd}"
        except ValueError:
            pass
    for k, pats in (("unidade_cota", RE_COTA), ("resort_bruto", RE_RESORT),
                    ("reu_resort", RE_REUS), ("tipo_acao", RE_ACAO)):
        v = first(pats, txt)
        if v:
            out[k] = re.sub(r"\s+", " ", v)[:300]
    head = txt[:7000]
    for m in RE_QUAL.finditer(head):
        if only_digits(m.group(5)) == cpf:
            ec, prof = fatiar_miolo(m.group(3) or "")
            out["qual"] = {"nome": re.sub(r"\s+", " ", m.group(1)).strip(),
                           "nacionalidade": m.group(2).upper(), "estado_civil": ec,
                           "profissao": prof, "rg": m.group(4).strip(), "cpf": cpf}
            break
    conj = None
    for m in RE_QUAL.finditer(head):
        c2 = only_digits(m.group(5))
        if c2 != cpf and len(c2) == 11:
            conj = {"cpf": c2, "nome": re.sub(r"\s+", " ", m.group(1)).strip()}
            break
    if conj:
        out["conjuge_cpf"], out["conjuge_nome"] = conj["cpf"], conj["nome"]
    for k, pat in (("cep", RE_CEP), ("email", RE_EMAIL), ("endereco", RE_END)):
        v = first([pat], head)
        if v:
            out[k] = only_digits(v) if k == "cep" else re.sub(r"\s+", " ", v)[:170]
    return out

IDX = None

def _init_worker():
    # macOS usa spawn: cada worker precisa construir o proprio indice
    global IDX
    IDX = indexar_pastas()

def processar(cli):
    global IDX
    pastas = achar_pasta(cli["n"], IDX)
    if not pastas:
        return {"id": cli["i"], "erro": "pasta_nao_encontrada"}
    cpf = cli["c"]
    for pasta, bucket in pastas:
        try:
            arquivos = [f for f in os.listdir(pasta) if f.lower().endswith((".pdf",))]
        except OSError:
            continue
        arquivos.sort(key=lambda f: -prio(f))
        for f in arquivos[:8]:                      # no maximo 8 docs por pasta
            p = os.path.join(pasta, f)
            try:
                if os.path.getsize(p) > 25_000_000:
                    continue
            except OSError:
                continue
            txt = texto(p)
            if len(txt) < 300:
                continue
            if cpf not in only_digits(txt[:12000]):  # o CPF do cliente tem que estar no doc
                continue
            ex = extrair_campos(txt, cpf)
            if not ex.get("valor_pago") and not ex.get("resort_bruto"):
                continue                             # doc sem dado util (ex: procuracao)
            ex.update({"cliente_id": cli["i"], "cpf": cpf, "nome_cadastro": cli["n"],
                       "arquivo": f, "bucket": bucket, "pasta_local": pasta})
            return ex
    return {"id": cli["i"], "erro": "sem_doc_com_cpf_e_dados"}

def main():
    global IDX
    fila = carregar_fila(sys.argv[1])
    out_path = sys.argv[2]
    workers = int(sys.argv[3]) if len(sys.argv) > 3 else 8
    IDX = indexar_pastas()
    print(json.dumps({"pastas_indexadas": len(IDX), "fila": len(fila)}), flush=True)
    with Pool(workers, initializer=_init_worker) as pool:
        res = pool.map(processar, fila, chunksize=4)
    ok = [r for r in res if r and "erro" not in r]
    st = {"processados": len(res), "resolvidos": len(ok),
          "com_valor": sum(1 for r in ok if r.get("valor_pago")),
          "com_resort": sum(1 for r in ok if r.get("resort_bruto")),
          "com_qual": sum(1 for r in ok if r.get("qual")),
          "sem_pasta": sum(1 for r in res if r and r.get("erro") == "pasta_nao_encontrada"),
          "sem_doc": sum(1 for r in res if r and r.get("erro") == "sem_doc_com_cpf_e_dados")}
    json.dump(ok, open(out_path, "w"), ensure_ascii=False)
    print(json.dumps(st, indent=1))

if __name__ == "__main__":
    main()

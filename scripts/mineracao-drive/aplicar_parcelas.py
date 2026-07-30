#!/usr/bin/env python3
"""Envia as cotas consolidadas (parcelas) ao banco via RPC parcelas_ingest, em lotes."""
import glob, json, os, re, subprocess, sys
SCRATCH = os.path.dirname(os.path.abspath(__file__))
URL = "https://vygczeepvoyaehfchxko.supabase.co/rest/v1/rpc/parcelas_ingest_t"
TICKET = sys.argv[1]
ak = None
for f in glob.glob("/Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos/client/dist/assets/*.js"):
    m = re.search(r"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9[A-Za-z0-9_.-]{40,}", open(f,"rb").read().decode("utf-8","ignore"))
    if m: ak = m.group(0); break
if not ak: sys.exit("anon key nao encontrada")
cotas = json.load(open(os.path.join(SCRATCH,"parcelas_por_cota.json")))
tot = {"cotas":0,"parcelas":0,"acoes_atualizadas":0,"sem_cliente":0,"erros":0}
LOTE = 40
for i in range(0, len(cotas), LOTE):
    payload = json.dumps({"p_ticket": TICKET, "p_rows": cotas[i:i+LOTE]}, ensure_ascii=False)
    p = subprocess.run(["curl","-s","-X","POST",URL,"-H",f"apikey: {ak}","-H",f"Authorization: Bearer {ak}",
                        "-H","Content-Type: application/json","--data-binary","@-"],
                       input=payload.encode(), capture_output=True, timeout=300)
    try:
        r = json.loads(p.stdout.decode())
        if isinstance(r, dict) and "cotas" in r:
            for k in ("cotas","parcelas","acoes_atualizadas","sem_cliente"): tot[k] += r.get(k,0)
        else:
            tot["erros"] += 1; tot.setdefault("ultimo_erro", str(r)[:200])
    except Exception as e:
        tot["erros"] += 1; tot.setdefault("ultimo_erro", f"{e}: {p.stdout[:150]}")
print(json.dumps({"cotas_enviadas": len(cotas), **tot}, indent=1, ensure_ascii=False))

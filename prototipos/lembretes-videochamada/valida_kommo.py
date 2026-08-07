#!/usr/bin/env python3
"""Validacao SOMENTE LEITURA do bot de lembretes contra o Kommo real.
Nenhuma escrita, nenhuma mensagem enviada. Confere, para cada videochamada futura:
  - o lead existe e esta acessivel
  - o telefone do contato bate com o telefone do titulo do evento (DDD + 8 digitos)
  - o nome do lead bate com o nome do titulo
  - quando foi a ultima mensagem RECEBIDA do contato -> janela de 24h aberta ou fechada
Tambem confere campo custom, salesbot e templates da conta.
"""
import json, re, time, urllib.request, urllib.error
from datetime import datetime, timezone, timedelta

SEC = "/Users/pauloconforto/Desktop/Claude Codex/projetos/chatguru-export/kommo-backfill/_secrets.json"
d = json.load(open(SEC))
TOK, SUB = d["KOMMO_TOKEN"], d["KOMMO_SUBDOMAIN"]
BASE = f"https://{SUB}.kommo.com/api/v4"
BRT = timezone(timedelta(hours=-3))

CALLS = json.load(open(__file__.replace("valida_kommo.py", "calls.json")))


def kget(path):
    req = urllib.request.Request(BASE + path, headers={"Authorization": "Bearer " + TOK})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            if r.status == 204:
                return {}
            return json.load(r)
    except urllib.error.HTTPError as e:
        return {"_erro": e.code, "_corpo": e.read()[:120].decode("utf-8", "ignore")}
    except Exception as e:
        return {"_erro": type(e).__name__}
    finally:
        time.sleep(0.2)  # throttle (padrao da casa)


def canon(t):
    """DDD + 8 digitos finais, tolerando o nono digito e o 55."""
    dig = re.sub(r"\D", "", t or "")
    if dig.startswith("55") and len(dig) > 10:
        dig = dig[2:]
    if len(dig) >= 10:
        return dig[:2] + dig[-8:]
    return dig


def primeiro_nome(titulo):
    m = re.match(r"\s*([A-Za-zÀ-ÿ]{2,})", titulo or "")
    return m.group(1).lower() if m else None


print("=" * 78)
print("1. CONFIGURACAO DA CONTA")
print("=" * 78)

cf = kget("/leads/custom_fields?limit=250")
campos = {c["id"]: c for c in (cf.get("_embedded", {}).get("custom_fields") or [])}
for fid in (2444884, 2441560, 2434598):
    c = campos.get(fid)
    print(f"  campo {fid}: " + (f"'{c['name']}' tipo={c['type']}" if c else "NAO ENCONTRADO"))

for p in ("/salesbot", "/bots"):
    r = kget(p)
    n = len((r.get("_embedded", {}) or {}).get("bots") or []) if "_erro" not in r else None
    print(f"  GET {p}: " + (f"erro {r['_erro']}" if "_erro" in r else f"ok, {n} bots"))

for p in ("/chats/templates?limit=50", "/chats/tools/templates?limit=50", "/templates?limit=50"):
    r = kget(p)
    if "_erro" in r:
        print(f"  GET {p}: erro {r['_erro']}")
    else:
        ts = (r.get("_embedded", {}) or {}).get("chat_templates") or (r.get("_embedded", {}) or {}).get("templates") or []
        print(f"  GET {p}: ok, {len(ts)} templates")
        for t in ts[:12]:
            print(f"      - {t.get('name')!r} | externo={t.get('external_id')} | status={t.get('review_status') or t.get('status')}")

print()
print("=" * 78)
print("2. AS VIDEOCHAMADAS FUTURAS, UMA A UMA")
print("=" * 78)
agora = datetime.now(timezone.utc)
res = {"ok": 0, "tel_diverge": 0, "nome_diverge": 0, "lead_morto": 0, "sem_lead": 0,
       "janela_aberta": 0, "janela_fechada": 0, "sem_msg": 0}

for c in CALLS:
    tel_ev = canon(c["tel"])
    nome_ev = primeiro_nome(c["titulo"])
    tag = f"{c['quando']} {c['vend'][:8]:<8} {(nome_ev or '?'):<10}"
    if not c["lead"]:
        res["sem_lead"] += 1
        print(f"{tag} SEM LEAD ({c['match']}) -> pendencia p/ a vendedora")
        continue

    lead = kget(f"/leads/{c['lead']}?with=contacts")
    if "_erro" in lead:
        res["lead_morto"] += 1
        print(f"{tag} LEAD {c['lead']} INACESSIVEL (HTTP {lead['_erro']})")
        continue

    nome_lead = (lead.get("name") or "").strip()
    cont = ((lead.get("_embedded", {}) or {}).get("contacts") or [])
    main = next((x for x in cont if x.get("is_main")), cont[0] if cont else None)
    if not main:
        print(f"{tag} lead ok, mas SEM CONTATO vinculado")
        continue

    ct = kget(f"/contacts/{main['id']}")
    fones = []
    for f in ((ct.get("custom_fields_values") or []) if "_erro" not in ct else []):
        if f.get("field_code") == "PHONE":
            fones += [v.get("value") for v in (f.get("values") or [])]
    bate_tel = any(canon(f) == tel_ev for f in fones)
    bate_nome = bool(nome_ev) and nome_ev in (nome_lead + " " + (ct.get("name") or "")).lower()

    ev = kget(f"/events?filter[type]=incoming_chat_message&filter[entity]=contact"
              f"&filter[entity_id][]={main['id']}&limit=1")
    ts = None
    if "_erro" not in ev:
        itens = (ev.get("_embedded", {}) or {}).get("events") or []
        if itens:
            ts = itens[0].get("created_at")
    if ts:
        horas = (agora - datetime.fromtimestamp(ts, timezone.utc)).total_seconds() / 3600
        janela = "ABERTA" if horas < 24 else "fechada"
        res["janela_aberta" if horas < 24 else "janela_fechada"] += 1
        jtxt = f"janela {janela} (ultima msg ha {horas:.0f}h)"
    else:
        res["sem_msg"] += 1
        jtxt = "janela fechada (nenhuma msg recebida)"

    if not bate_tel:
        res["tel_diverge"] += 1
    if not bate_nome:
        res["nome_diverge"] += 1
    if bate_tel and bate_nome:
        res["ok"] += 1

    print(f"{tag} lead ok | tel {'BATE' if bate_tel else 'DIVERGE'} | "
          f"nome {'bate' if bate_nome else 'DIVERGE (' + nome_lead[:22] + ')'} | {jtxt}")

print()
print("=" * 78)
print("3. RESUMO")
print("=" * 78)
for k, v in res.items():
    print(f"  {k:<16} {v}")

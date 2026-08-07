#!/usr/bin/env python3
"""Disparo de TESTE do lembrete de videochamada, para o numero do proprio Paulo.

Simula o que o cron fara: monta a frase do horario em BRT a partir do evento do
Google Agenda, grava no campo do lead e roda o Salesbot que exibe o campo.
Sem IA, sem escrita na agenda. So funciona com a janela de 24h ABERTA.
"""
import json, urllib.request, urllib.error, time, sys
from datetime import datetime, timezone, timedelta

SEC = "/Users/pauloconforto/Desktop/Claude Codex/projetos/chatguru-export/kommo-backfill/_secrets.json"
d = json.load(open(SEC))
TOK, SUB = d["KOMMO_TOKEN"], d["KOMMO_SUBDOMAIN"]
BASE = f"https://{SUB}.kommo.com/api/v4"
H = {"Authorization": "Bearer " + TOK, "Content-Type": "application/json"}

# O numero tem 3 contatos no Kommo. A conversa viva esta na do contato 15150774
# ("PC"). Regra que vai para o desenho: com telefone em varios leads, vence o que
# tem a mensagem RECEBIDA mais recente, nao o lead mais novo.
LEAD = 18909758            # contato 15150774 "PC" (tel 5519993388370)
CAMPO_CARTEIRO = 2444884   # "CBC Ana" (textarea) — o campo que o Salesbot exibe
BOT = 103102               # Salesbot "CBC - Ana": 1 passo, mensagem [Lead: CBC Ana]

# Dados do evento REAL criado no Google Agenda
EVENTO = {"inicio": "2026-08-04T14:00:00-03:00",
          "meet": "https://meet.google.com/kdg-qgep-tto",
          "nome": "Paulo"}

BRT = timezone(timedelta(hours=-3))
DIAS = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]


def frase_quando(iso, agora=None):
    """A frase do horario, SEMPRE em Brasilia. Uma linha so: valor de variavel de
    modelo nao aceita quebra de linha."""
    dt = datetime.fromisoformat(iso).astimezone(BRT)
    hoje = (agora or datetime.now(BRT)).date()
    hora = dt.strftime("%Hh%M")
    if dt.date() == hoje:
        return f"hoje às {hora}"
    if dt.date() == hoje + timedelta(days=1):
        return f"amanhã, {DIAS[dt.weekday()]} ({dt.strftime('%d/%m')}), às {hora}"
    return f"{DIAS[dt.weekday()]} ({dt.strftime('%d/%m')}), às {hora}"


def sanitiza(t):
    """Lição de 31/07: o Kommo trunca campo no primeiro emoji de 4 bytes."""
    return "".join(c for c in t if len(c.encode()) < 4)


def req(metodo, path, body=None):
    r = urllib.request.Request(BASE + path, headers=H, method=metodo,
                               data=json.dumps(body).encode() if body is not None else None)
    try:
        resp = urllib.request.urlopen(r, timeout=25)
        corpo = resp.read()
        # /bots/run responde 202 com corpo VAZIO: json.load ali estoura.
        return json.loads(corpo) if corpo.strip() else {"_status": resp.status}
    except urllib.error.HTTPError as e:
        return {"_erro": e.code, "_corpo": e.read()[:300].decode("utf-8", "ignore")}
    finally:
        time.sleep(0.3)


def janela_aberta(lead_id):
    lead = req("GET", f"/leads/{lead_id}?with=contacts")
    cs = (lead.get("_embedded") or {}).get("contacts") or []
    main = next((c for c in cs if c.get("is_main")), cs[0] if cs else None)
    if not main:
        return False, "lead sem contato", None
    ev = req("GET", f"/events?filter[type]=incoming_chat_message&filter[entity]=contact"
                    f"&filter[entity_id][]={main['id']}&limit=1")
    it = ((ev.get("_embedded") or {}).get("events") or []) if "_erro" not in ev else []
    if not it:
        return False, "nenhuma mensagem recebida", main["id"]
    h = (datetime.now(timezone.utc) - datetime.fromtimestamp(it[0]["created_at"], timezone.utc)).total_seconds() / 3600
    return h < 24, f"ultima msg ha {h:.1f}h", main["id"]


quando = frase_quando(EVENTO["inicio"])
texto = sanitiza(
    f"Olá, {EVENTO['nome']}! Aqui é do escritório Conforto Bergonsi Advogados.\n\n"
    f"Sua videochamada é {quando}.\n\n"
    f"É só entrar por aqui no horário: {EVENTO['meet']}\n\n"
    f"Qualquer imprevisto, é só responder nesta conversa."
)

print("=" * 70)
print("FRASE DO HORARIO:", quando)
print("-" * 70)
print(texto)
print("=" * 70)

aberta, motivo, contato = janela_aberta(LEAD)
print(f"janela de 24h: {'ABERTA' if aberta else 'FECHADA'} ({motivo}) | contato {contato}")
if not aberta:
    print("\nPARADO: sem janela aberta a mensagem comum nao e entregue.")
    print("Peca ao Paulo para mandar qualquer mensagem para +55 19 98805-1878 e rode de novo.")
    sys.exit(1)

if "--enviar" not in sys.argv:
    print("\n(simulacao — rode com --enviar para disparar de verdade)")
    sys.exit(0)

# 1) grava o campo
r = req("PATCH", f"/leads/{LEAD}",
        {"custom_fields_values": [{"field_id": CAMPO_CARTEIRO, "values": [{"value": texto}]}]})
if "_erro" in r:
    print("ERRO ao gravar campo:", r); sys.exit(1)

# 2) CONFERE que gravou (licao do bug de truncamento de 31/07)
lead = req("GET", f"/leads/{LEAD}")
gravado = None
for f in (lead.get("custom_fields_values") or []):
    if f.get("field_id") == CAMPO_CARTEIRO:
        gravado = (f.get("values") or [{}])[0].get("value")
print(f"campo gravado: {len(gravado or '')} de {len(texto)} caracteres",
      "-> OK" if gravado == texto else "-> DIVERGIU (truncou?)")
if gravado != texto:
    print("PARADO: o campo nao bate com o texto. Nao vou disparar."); sys.exit(1)

# 3) roda o Salesbot
r = req("POST", "/bots/run", [{"bot_id": BOT, "entity_id": LEAD, "entity_type": "leads"}])
print("salesbot:", json.dumps(r, ensure_ascii=False)[:300])

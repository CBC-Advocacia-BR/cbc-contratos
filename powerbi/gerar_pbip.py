#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Gera o projeto Power BI do Painel CBC no formato CLASSICO do PBIP
(model.bim TMSL + report.json legado) — abre em qualquer Power BI Desktop
sem recursos de visualizacao. v2 02/07/2026 (v1 em TMDL/PBIR exigia preview)."""
import json, os, shutil, zipfile

ROOT = "/Users/pauloconforto/Desktop/Claude Codex/projetos/cbc-contratos/powerbi"
PROJ = os.path.join(ROOT, "CBC-Painel")
SM = os.path.join(PROJ, "CBC-Painel.SemanticModel")
RP = os.path.join(PROJ, "CBC-Painel.Report")

SERVER = "aws-1-sa-east-1.pooler.supabase.com:5432"

TYPEMAP = {
    "bigint": "int64", "integer": "int64", "smallint": "int64",
    "text": "string", "uuid": "string",
    "date": "dateTime", "timestamp with time zone": "dateTime",
    "boolean": "boolean", "numeric": "decimal", "double precision": "double",
}

TABLES = {
    "Produtividade": ("vw_bi_produtividade", [
        ("tarefa_id","bigint"),("tarefa","text"),("pessoa","text"),("data_conclusao","date"),
        ("mes_conclusao","date"),("data_agendada","date"),("data_criacao_real","date"),
        ("dias_vs_agendado","integer"),("tempo_ciclo_dias","integer"),("reward","numeric"),
        ("categoria","text"),("oculta_do_cliente","boolean"),("processo","text"),("cliente","text"),
        ("processo_id_advbox","bigint"),("equipe","text"),("retrabalho","boolean")]),
    "CargaAtual": ("vw_bi_carga_atual", [
        ("tarefa_id","bigint"),("tarefa","text"),("pessoa","text"),("equipe","text"),("status","text"),
        ("data_agendada","date"),("data_criacao_real","date"),("prazo","date"),("dias_em_aberto","integer"),
        ("faixa_aging","text"),("agendada_para_futuro","boolean"),("processo","text"),("cliente","text"),
        ("processo_id_advbox","bigint"),("oculta_do_cliente","boolean"),("situacao_agenda","text")]),
    "Distribuicao": ("vw_bi_distribuicao", [
        ("lawsuit_id","bigint"),("process_number","text"),("tipo","text"),("grupo","text"),("quadro","text"),
        ("etapa","text"),("responsavel","text"),("clientes","text"),("criado_em","date"),("distribuido_em","date"),
        ("tarefa_distribuir_concluida","date"),("dias_ate_distribuir","integer"),
        ("dias_ate_tarefa_distribuir","integer"),("distribuido","boolean"),("dias_aguardando","integer"),
        ("cadastro_retroativo","boolean")]),
    "PreDistribuicao": ("vw_bi_tarefas_pre_distribuicao", [
        ("tarefa_id","bigint"),("tarefa","text"),("pessoa","text"),("data_conclusao","date"),
        ("mes_conclusao","date"),("data_agendada","date"),("data_criacao_real","date"),
        ("dias_vs_agendado","integer"),("tempo_ciclo_dias","integer"),("reward","numeric"),
        ("categoria","text"),("oculta_do_cliente","boolean"),("processo","text"),("cliente","text"),
        ("processo_id_advbox","bigint"),("equipe","text"),("retrabalho","boolean"),("distribuido_em","date"),
        ("dias_antes_da_distribuicao","integer"),("criado_em","date"),("dias_desde_criacao","integer"),
        ("cadastro_retroativo","boolean")]),
    "FunilEtapas": ("vw_bi_funil_etapas", [
        ("lawsuit_id","bigint"),("process_number","text"),("etapa","text"),
        ("inicio","timestamp with time zone"),("fim","timestamp with time zone"),
        ("dias_na_etapa","numeric"),("em_andamento","boolean"),("quadro","text"),("responsavel","text"),
        ("etapa_atual_processo","text")]),
    "Processos": ("vw_bi_processos", [
        ("lawsuit_id","bigint"),("process_number","text"),("protocol_number","text"),("folder","text"),
        ("process_date","date"),("tipo","text"),("grupo","text"),("quadro","text"),("etapa","text"),
        ("stages_id","bigint"),("responsavel","text"),("fees_expec","numeric"),("fees_money","numeric"),
        ("contingency","numeric"),("status_closure","text"),("exit_production","text"),
        ("exit_execution","text"),("clientes","text"),("parte_contraria","text"),
        ("criado_em_advbox","text"),("atualizado_em","timestamp with time zone")]),
    "Andamentos": ("vw_bi_andamentos", [
        ("processo_id_advbox","bigint"),("processo","text"),("cliente","text"),("data","date"),
        ("andamento","text"),("tribunal","text"),("veio_do_backfill","boolean"),
        ("detectado_em","timestamp with time zone")]),
    "Clientes": ("bi_clientes", [
        ("customer_id","bigint"),("nome","text"),("cpf_cnpj","text"),("email","text"),("celular","text"),
        ("telefone","text"),("cidade","text"),("uf","text"),("profissao","text"),("estado_civil","text"),
        ("genero","text"),("nascimento","date"),("origem","text"),("criado_em_advbox","text"),
        ("qtd_processos","integer"),("atualizado_em","timestamp with time zone"),("eh_pf","boolean"),
        ("cliente_uid","uuid"),("logradouro","text"),("cep","text"),("bairro","text"),("rg","text")]),
    "Contratos": ("vw_powerbi_contratos", [
        ("id","uuid"),("created_at","timestamp with time zone"),("updated_at","timestamp with time zone"),
        ("nome_contratante1","text"),("cpf_contratante1","text"),("email_contratante1","text"),
        ("nome_contratante2","text"),("cpf_contratante2","text"),("resort","text"),("tipo_acao","text"),
        ("honorarios_total","numeric"),("honorarios_parcelas","integer"),("honorarios_valor_parcela","numeric"),
        ("honorarios_percentual_exito","numeric"),("data_primeira_parcela","date"),("status","text"),
        ("created_by","text"),("updated_by","text"),("zapsign_sent_at","timestamp with time zone"),
        ("signed_at","timestamp with time zone"),("advbox_date","timestamp with time zone"),
        ("observacoes_internas","text"),("advbox_status","text"),("sexo_contratante1","text"),
        ("sexo_contratante2","text"),("origem_cliente","text"),("data_primeira_mensagem","text"),
        ("jornada_compra_dias","integer"),("tempo_assinatura_dias","numeric"),("mes_criacao","text"),
        ("ano_criacao","text"),("tipo_honorario","text")]),
    "Videochamadas": ("vw_funil_videochamadas", [
        ("event_id","text"),("vendedora_email","text"),("status","text"),("color_id","text"),
        ("scheduled_at","timestamp with time zone"),("tem_meet","boolean")]),
}

CALC_COLS = {
    "Videochamadas": [("MesAgenda", "FORMAT('Videochamadas'[scheduled_at], \"YYYY-MM\")")],
    "Andamentos": [("MesAndamento", "FORMAT('Andamentos'[data], \"YYYY-MM\")")],
}

MEASURES = {
    "Produtividade": [
        ("Concluídas", 'CALCULATE(COUNTROWS(Produtividade), Produtividade[categoria] <> "sistema")', "#,0"),
        ("Tempo Mediano (dias)", 'CALCULATE(MEDIAN(Produtividade[tempo_ciclo_dias]), Produtividade[categoria] = "ciclo")', "0.0"),
        ("Tempo Médio (dias)", 'CALCULATE(AVERAGE(Produtividade[tempo_ciclo_dias]), Produtividade[categoria] = "ciclo")', "0.0"),
        ("% Em Dia", 'DIVIDE(CALCULATE([Concluídas], Produtividade[dias_vs_agendado] <= 0), CALCULATE([Concluídas], NOT ISBLANK(Produtividade[dias_vs_agendado])))', "0.0%"),
        # "Qtde Retrabalho" (nao "Retrabalho"): medida nao pode ter o mesmo nome
        # de uma coluna da MESMA tabela (case-insensitive) — erro real no Desktop
        ("Qtde Retrabalho", 'CALCULATE([Concluídas], Produtividade[retrabalho] = TRUE())', "#,0"),
        ("Taxa Retrabalho Inicial", 'DIVIDE(CALCULATE([Concluídas], Produtividade[tarefa] = "REFAZER INICIAL"), CALCULATE([Concluídas], Produtividade[tarefa] = "FAZER INICIAL"))', "0.0%"),
    ],
    "CargaAtual": [
        ("Tarefas Abertas", "COUNTROWS(CargaAtual)", "#,0"),
        ("Vencidas", 'CALCULATE(COUNTROWS(CargaAtual), CargaAtual[situacao_agenda] = "vencida")', "#,0"),
        # unicas (nao atribuicoes pessoa x tarefa) — p/ CARTOES de total
        ("Tarefas Vencidas", 'CALCULATE(DISTINCTCOUNT(CargaAtual[tarefa_id]), CargaAtual[situacao_agenda] = "vencida")', "#,0"),
    ],
    "Distribuicao": [
        ("Distribuídos", 'CALCULATE(COUNTROWS(Distribuicao), Distribuicao[distribuido] = TRUE(), Distribuicao[cadastro_retroativo] = FALSE())', "#,0"),
        ("Dias até Distribuir (mediana)", 'CALCULATE(MEDIAN(Distribuicao[dias_ate_distribuir]), Distribuicao[cadastro_retroativo] = FALSE())', "0.0"),
        ("Aguardando Distribuição", 'CALCULATE(COUNTROWS(Distribuicao), Distribuicao[distribuido] = FALSE(), ALL(Calendario))', "#,0"),
        ("Dias Aguardando", 'CALCULATE(MAX(Distribuicao[dias_aguardando]), Distribuicao[distribuido] = FALSE())', "#,0"),
    ],
    "PreDistribuicao": [
        ("Dia Mediano no Processo", 'CALCULATE(MEDIAN(PreDistribuicao[dias_desde_criacao]), PreDistribuicao[cadastro_retroativo] = FALSE(), PreDistribuicao[categoria] = "ciclo")', "0.0"),
        ("Ciclo Médio (dias)", 'CALCULATE(AVERAGE(PreDistribuicao[tempo_ciclo_dias]), PreDistribuicao[cadastro_retroativo] = FALSE(), PreDistribuicao[categoria] = "ciclo")', "0.0"),
    ],
    "Contratos": [
        ("Contratos Criados", "COUNTROWS(Contratos)", "#,0"),
        ("Tempo Assinatura Médio (dias)", "AVERAGE(Contratos[tempo_assinatura_dias])", "0.0"),
    ],
    "Videochamadas": [("Qtde Videochamadas", "COUNTROWS(Videochamadas)", "#,0")],
    "Andamentos": [("Qtde Andamentos", "COUNTROWS(Andamentos)", "#,0")],
    "Processos": [("Qtde Processos", "COUNTROWS(Processos)", "#,0")],
    "Clientes": [("Qtde Clientes", "COUNTROWS(Clientes)", "#,0")],
    "FunilEtapas": [("Dias na Etapa (média)", "AVERAGE(FunilEtapas[dias_na_etapa])", "0.0")],
}

# ---------- model.bim (TMSL classico) ----------
def bim_table(name, view, cols):
    columns = []
    for (cname, pgtype) in cols:
        c = {"name": cname, "dataType": TYPEMAP[pgtype], "sourceColumn": cname, "summarizeBy": "none"}
        if pgtype == "date":
            c["formatString"] = "dd/mm/yyyy"
        columns.append(c)
    for (cname, dax) in CALC_COLS.get(name, []):
        columns.append({"name": cname, "dataType": "string", "type": "calculated",
                        "expression": dax, "summarizeBy": "none"})
    m_expr = (
        "let\n"
        f'    Source = PostgreSQL.Database("{SERVER}", "postgres"),\n'
        f'    dados = Source{{[Schema="public",Item="{view}"]}}[Data]\n'
        "in\n"
        "    dados"
    )
    t = {
        "name": name,
        "columns": columns,
        "partitions": [{"name": name, "mode": "import",
                        "source": {"type": "m", "expression": m_expr}}],
    }
    ms = MEASURES.get(name)
    if ms:
        t["measures"] = [{"name": n, "expression": e, "formatString": f} for (n, e, f) in ms]
    return t

def bim_calendario():
    return {
        "name": "Calendario",
        "dataCategory": "Time",
        "columns": [
            {"name": "Date", "dataType": "dateTime", "isKey": True, "isNameInferred": True,
             "type": "calculatedTableColumn", "sourceColumn": "[Date]",
             "formatString": "dd/mm/yyyy", "summarizeBy": "none"},
            {"name": "AnoMes", "dataType": "string", "type": "calculated",
             "expression": "FORMAT('Calendario'[Date], \"YYYY-MM\")", "summarizeBy": "none"},
        ],
        "partitions": [{"name": "Calendario", "mode": "import",
                        "source": {"type": "calculated",
                                   "expression": "CALENDAR(DATE(2025,1,1), TODAY())"}}],
    }

def build_bim():
    tables = [bim_table(n, v, c) for n, (v, c) in TABLES.items()] + [bim_calendario()]
    rels = [
        {"name": "rel_prod", "fromTable": "Produtividade", "fromColumn": "data_conclusao",
         "toTable": "Calendario", "toColumn": "Date"},
        {"name": "rel_dist", "fromTable": "Distribuicao", "fromColumn": "distribuido_em",
         "toTable": "Calendario", "toColumn": "Date"},
        {"name": "rel_pre", "fromTable": "PreDistribuicao", "fromColumn": "data_conclusao",
         "toTable": "Calendario", "toColumn": "Date"},
    ]
    return {
        "name": "CBC-Painel",
        "compatibilityLevel": 1550,
        "model": {
            "culture": "pt-BR",
            "defaultPowerBIDataSourceVersion": "powerBI_V3",
            "sourceQueryCulture": "pt-BR",
            "annotations": [{"name": "PBI_TimeIntelligenceEnabled", "value": "0"}],
            "tables": tables,
            "relationships": rels,
        },
    }

# ---------- report.json legado ----------
def field_ref(kind, table, prop, alias):
    return {kind: {"Expression": {"SourceRef": {"Source": alias}}, "Property": prop}}

def visual_config(vid, vtype, x, y, z, w, h, roles):
    # roles: {"Values": [("col"|"meas", tabela, campo), ...], ...}
    entities, aliases = [], {}
    for fields in roles.values():
        for (_k, t, _p) in fields:
            if t not in aliases:
                aliases[t] = f"t{len(aliases) + 1}"
                entities.append(t)
    select, projections = [], {}
    for role, fields in roles.items():
        projections[role] = []
        for (kind, t, p) in fields:
            qref = f"{t}.{p}"
            key = "Measure" if kind == "meas" else "Column"
            item = field_ref(key, t, p, aliases[t])
            item["Name"] = qref
            if not any(s.get("Name") == qref for s in select):
                select.append(item)
            projections[role].append({"queryRef": qref})
    cfg = {
        "name": vid,
        "layouts": [{"id": 0, "position": {"x": x, "y": y, "z": z, "width": w, "height": h}}],
        "singleVisual": {
            "visualType": vtype,
            "projections": projections,
            "prototypeQuery": {
                "Version": 2,
                "From": [{"Name": aliases[e], "Entity": e, "Type": 0} for e in entities],
                "Select": select,
            },
            "drillFilterOtherVisuals": True,
        },
    }
    return cfg

def C(t, p): return ("col", t, p)
def M(t, p): return ("meas", t, p)

PAGES = [
    ("p1", "1 · Produtividade", [
        ("v101","card",20,20,280,90,{"Values":[M("Produtividade","Concluídas")]}),
        ("v102","card",320,20,280,90,{"Values":[M("Produtividade","Tempo Mediano (dias)")]}),
        ("v103","card",620,20,280,90,{"Values":[M("Produtividade","% Em Dia")]}),
        ("v104","card",920,20,280,90,{"Values":[M("CargaAtual","Tarefas Vencidas")]}),
        ("v105","columnChart",20,130,620,260,{"Category":[C("Calendario","AnoMes")],"Y":[M("Produtividade","Concluídas")],"Series":[C("Produtividade","categoria")]}),
        ("v106","pivotTable",660,130,600,260,{"Rows":[C("Produtividade","pessoa")],"Columns":[C("Produtividade","categoria")],"Values":[M("Produtividade","Concluídas")]}),
        ("v107","barChart",20,410,620,290,{"Category":[C("Produtividade","pessoa")],"Y":[M("Produtividade","Concluídas")]}),
        ("v108","slicer",660,410,600,80,{"Values":[C("Calendario","Date")]}),
        ("v109","slicer",660,500,290,200,{"Values":[C("Produtividade","equipe")]}),
        ("v110","slicer",970,500,290,200,{"Values":[C("Produtividade","categoria")]}),
    ]),
    ("p2", "2 · Retrabalho", [
        ("v201","card",20,20,280,90,{"Values":[M("Produtividade","Qtde Retrabalho")]}),
        ("v202","card",320,20,280,90,{"Values":[M("Produtividade","Taxa Retrabalho Inicial")]}),
        ("v203","slicer",920,20,340,90,{"Values":[C("Calendario","Date")]}),
        ("v204","barChart",20,130,620,560,{"Category":[C("Produtividade","pessoa")],"Y":[M("Produtividade","Qtde Retrabalho")],"Series":[C("Produtividade","tarefa")]}),
        ("v205","columnChart",660,130,600,250,{"Category":[C("Calendario","AnoMes")],"Y":[M("Produtividade","Qtde Retrabalho")]}),
        ("v206","pivotTable",660,400,600,290,{"Rows":[C("Produtividade","pessoa")],"Columns":[C("Produtividade","tarefa")],"Values":[M("Produtividade","Qtde Retrabalho")]}),
    ]),
    ("p3", "3 · Distribuição", [
        ("v301","card",20,20,280,90,{"Values":[M("Distribuicao","Dias até Distribuir (mediana)")]}),
        ("v302","card",320,20,280,90,{"Values":[M("Distribuicao","Distribuídos")]}),
        ("v303","card",620,20,280,90,{"Values":[M("Distribuicao","Aguardando Distribuição")]}),
        ("v304","lineChart",20,130,610,250,{"Category":[C("Calendario","AnoMes")],"Y":[M("Distribuicao","Dias até Distribuir (mediana)")]}),
        ("v305","barChart",650,130,610,250,{"Category":[C("PreDistribuicao","tarefa")],"Y":[M("PreDistribuicao","Dia Mediano no Processo")]}),
        ("v306","barChart",650,400,610,290,{"Category":[C("PreDistribuicao","tarefa")],"Y":[M("PreDistribuicao","Ciclo Médio (dias)")]}),
        ("v307","tableEx",20,400,610,290,{"Values":[C("Distribuicao","process_number"),C("Distribuicao","clientes"),C("Distribuicao","criado_em"),C("Distribuicao","etapa"),M("Distribuicao","Dias Aguardando")]}),
    ]),
    ("p4", "4 · Carga atual", [
        ("v401","card",20,20,280,90,{"Values":[M("CargaAtual","Tarefas Abertas")]}),
        ("v402","card",320,20,280,90,{"Values":[M("CargaAtual","Vencidas")]}),
        ("v403","slicer",620,20,300,90,{"Values":[C("CargaAtual","equipe")]}),
        ("v404","slicer",940,20,320,90,{"Values":[C("CargaAtual","situacao_agenda")]}),
        ("v405","barChart",20,130,720,560,{"Category":[C("CargaAtual","pessoa")],"Y":[M("CargaAtual","Tarefas Abertas")],"Series":[C("CargaAtual","situacao_agenda")]}),
        ("v406","tableEx",760,130,500,560,{"Values":[C("CargaAtual","pessoa"),C("CargaAtual","tarefa"),C("CargaAtual","cliente"),C("CargaAtual","data_agendada"),C("CargaAtual","situacao_agenda"),C("CargaAtual","dias_em_aberto")]}),
    ]),
    ("p5", "5 · Comercial", [
        ("v501","funnel",20,20,400,300,{"Category":[C("Contratos","status")],"Y":[M("Contratos","Contratos Criados")]}),
        ("v502","barChart",440,20,820,300,{"Category":[C("Contratos","created_by")],"Y":[M("Contratos","Contratos Criados")]}),
        ("v503","barChart",20,340,400,350,{"Category":[C("Contratos","created_by")],"Y":[M("Contratos","Tempo Assinatura Médio (dias)")]}),
        ("v504","columnChart",440,340,500,350,{"Category":[C("Videochamadas","MesAgenda")],"Y":[M("Videochamadas","Qtde Videochamadas")],"Series":[C("Videochamadas","status")]}),
        ("v505","columnChart",960,340,300,350,{"Category":[C("Contratos","origem_cliente")],"Y":[M("Contratos","Contratos Criados")]}),
    ]),
    ("p6", "6 · Carteira", [
        ("v601","barChart",20,20,400,330,{"Category":[C("Processos","quadro")],"Y":[M("Processos","Qtde Processos")]}),
        ("v602","barChart",440,20,820,330,{"Category":[C("FunilEtapas","etapa")],"Y":[M("FunilEtapas","Dias na Etapa (média)")]}),
        ("v603","columnChart",20,370,610,330,{"Category":[C("Andamentos","MesAndamento")],"Y":[M("Andamentos","Qtde Andamentos")]}),
        ("v604","treemap",650,370,300,330,{"Group":[C("Clientes","origem")],"Values":[M("Clientes","Qtde Clientes")]}),
        ("v605","treemap",970,370,290,330,{"Group":[C("Clientes","uf")],"Values":[M("Clientes","Qtde Clientes")]}),
    ]),
]

def build_report():
    # Esqueleto no formato dos .pbix reais: ids numericos no relatorio, nas
    # secoes e nos visuais + resourcePackages/tema base (sem eles o Desktop
    # abre o modelo mas falha em "renderizar o relatorio" — erro real v3).
    sections = []
    z = 0
    vc_id = 0
    for ordinal, (pid, pname, visuals) in enumerate(PAGES):
        vcs = []
        for (vid, vtype, x, y, w, h, roles) in visuals:
            z += 100
            vc_id += 1
            cfg = visual_config(vid, vtype, x, y, z, w, h, roles)
            vcs.append({
                "id": vc_id,
                "x": float(x), "y": float(y), "z": float(z),
                "width": float(w), "height": float(h),
                "config": json.dumps(cfg, ensure_ascii=False),
                "filters": "[]",
                "tabOrder": vc_id,
            })
        sections.append({
            "id": ordinal,
            "name": pid, "displayName": pname, "ordinal": ordinal,
            "width": 1280, "height": 720, "displayOption": 1,
            "config": "{}", "filters": "[]",
            "visualContainers": vcs,
        })
    return {
        "id": 0,
        "config": json.dumps({
            "version": "5.37",
            "themeCollection": {"baseTheme": {"name": "CY24SU06", "type": 2}},
            "activeSectionIndex": 0,
            "defaultDrillFilterOtherVisuals": True,
        }),
        "layoutOptimization": 0,
        "resourcePackages": [{"resourcePackage": {"name": "SharedResources", "type": 2,
            "items": [{"name": "CY24SU06", "path": "BaseThemes/CY24SU06.json", "type": 202}]}}],
        "sections": sections,
        "filters": "[]",
        "publicCustomVisuals": [],
    }

def wj(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)

def wt(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)

def main():
    if os.path.exists(PROJ):
        shutil.rmtree(PROJ)
    wj(os.path.join(PROJ, "CBC-Painel.pbip"), {
        "version": "1.0",
        "artifacts": [{"report": {"path": "CBC-Painel.Report"}}],
        "settings": {"enableAutoRecovery": True},
    })
    wt(os.path.join(PROJ, ".gitignore"), "*.abf\n.pbi/localSettings.json\n.pbi/cache.abf\n")
    # SemanticModel (formato classico: model.bim)
    wj(os.path.join(SM, "definition.pbism"), {"version": "1.0", "settings": {}})
    wj(os.path.join(SM, "model.bim"), build_bim())
    # Report (formato classico: report.json na raiz da pasta)
    wj(os.path.join(RP, "definition.pbir"), {
        "version": "1.0",
        "datasetReference": {"byPath": {"path": "../CBC-Painel.SemanticModel"}},
    })
    wj(os.path.join(RP, "report.json"), build_report())
    wt(os.path.join(PROJ, "LEIA-ME.txt"), """PAINEL CBC — COMO ABRIR (Windows)  [v5 — formato classico]
===========================================================

1. Copie a PASTA INTEIRA "CBC-Painel" para o computador Windows
   (se veio no ZIP, extraia TUDO antes — botão direito > Extrair Tudo).

2. Instale/atualize o Power BI Desktop (Microsoft Store, gratuito).

3. Dê dois cliques em  CBC-Painel.pbip

4. IMPORTANTE (evita o erro "max clients reached... pool_size: 15"):
   Arquivo > Opções e configurações > Opções > seção ARQUIVO ATUAL >
   Carregamento de Dados > DESMARQUE "Habilitar carregamento paralelo
   de tabelas" > OK. (O banco aceita 15 conexões por vez; sem isso o
   Power BI tenta baixar as 10 tabelas juntas e estoura o limite.)

5. O painel abre com os gráficos VAZIOS (o arquivo não carrega dados
   por segurança). Clique no botão ATUALIZAR (aba Página Inicial).

6. Na janela de credenciais, aba "Banco de dados" (NÃO a aba Windows):
   Usuário: powerbi_cbc.vygczeepvoyaehfchxko
   Senha:   (pedir ao Paulo / Claude)
   Se aparecer aviso de criptografia, aceite conectar sem criptografia.

7. Aguarde 2-4 min (as tabelas baixam uma por vez).
   Pronto: 6 páginas nas abas de baixo.
   Depois: Arquivo > Salvar. Para publicar no navegador e agendar
   atualização, siga a Etapa 8 do tutorial (docs/POWERBI_PAINEL_TUTORIAL.md).

Qualquer erro: tire um print e mande para o Claude —
o arquivo é texto e se corrige em minutos.
""")
    # ZIP v5
    zpath = os.path.join(ROOT, "CBC-Painel-PowerBI-v5.zip")
    if os.path.exists(zpath):
        os.remove(zpath)
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as zf:
        for base, _dirs, files in os.walk(PROJ):
            for fn in files:
                full = os.path.join(base, fn)
                zf.write(full, os.path.relpath(full, ROOT))
    # validacao: JSONs parseiam + configs internas parseiam
    n = 0
    for base, _d, files in os.walk(PROJ):
        for fn in files:
            if fn.endswith((".json", ".pbip", ".pbism", ".pbir", ".bim")):
                json.load(open(os.path.join(base, fn), encoding="utf-8")); n += 1
    rep = json.load(open(os.path.join(RP, "report.json"), encoding="utf-8"))
    nvis = 0
    for s in rep["sections"]:
        for vc in s["visualContainers"]:
            json.loads(vc["config"]); nvis += 1
    bim = json.load(open(os.path.join(SM, "model.bim"), encoding="utf-8"))
    nmeas = sum(len(t.get("measures", [])) for t in bim["model"]["tables"])
    print(f"OK v2: {n} arquivos validos | {len(rep['sections'])} paginas, {nvis} visuais | "
          f"{len(bim['model']['tables'])} tabelas, {nmeas} medidas | ZIP: {zpath} "
          f"({os.path.getsize(zpath)/1024:.0f} KB)")

if __name__ == "__main__":
    main()

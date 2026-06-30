/**
 * Widget Kommo (lcard) — Bot ADVBOX / CBC Contratos
 * Mostra no painel direito do cartao do lead:
 *   - fase atual do processo (ADVBOX)
 *   - alerta de novidades nao comunicadas
 *   - botao "copiar resposta pronta" (texto ja traduzido p/ o cliente)
 *
 * Backend: function advbox-bot-reply (action: widget) no Netlify.
 * settings.api_url = https://contratos-cbc.netlify.app/.netlify/functions/advbox-bot-reply
 * settings.api_key = valor de BOT_PANEL_KEY
 */
define(['jquery'], function ($) {
  var CustomWidget = function () {
    var self = this;

    function leadId() {
      try { return (window.APP && APP.data && APP.data.current_card && APP.data.current_card.id) || null; }
      catch (e) { return null; }
    }

    function esc(s) {
      return String(s || '').replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }

    function renderBox(html) {
      var $root = $('#cbc-bot-widget');
      if (!$root.length) {
        // anexa no painel lateral direito do cartao
        var holder = $('.card-widgets__wrapper, #widgets_block, .widget_cell').first();
        $root = $('<div id="cbc-bot-widget" style="padding:10px;border:1px solid #e2e8f0;border-radius:8px;margin:8px 0;background:#fff;font-size:13px;line-height:1.45"></div>');
        holder.prepend($root);
      }
      $root.html(html);
    }

    function load() {
      var id = leadId();
      var url = self.get_settings().api_url;
      var key = self.get_settings().api_key;
      if (!id || !url) return;
      renderBox('<b>⚖️ Bot ADVBOX</b><br><span style="color:#888">consultando processo…</span>');
      $.ajax({
        url: url + '?key=' + encodeURIComponent(key),
        method: 'POST',
        contentType: 'application/json',
        dataType: 'json',
        data: JSON.stringify({ action: 'widget', lead_id: id }),
        success: function (r) {
          if (!r || !r.ok) { renderBox('<b>⚖️ Bot ADVBOX</b><br><span style="color:#c00">erro: ' + esc(r && r.error) + '</span>'); return; }
          if (!r.found) { renderBox('<b>⚖️ Bot ADVBOX</b><br><span style="color:#888">Nenhum processo ADVBOX vinculado a este lead.</span>'); return; }
          var html = '<b>⚖️ Bot ADVBOX</b><br>';
          if (r.fase) html += 'Fase: <b>' + esc(r.fase) + '</b><br>';
          if (r.nao_comunicadas > 0) {
            html += '<div style="margin:6px 0;padding:6px 8px;background:#FEF3C7;border-radius:6px;color:#92400E">🔔 <b>' + r.nao_comunicadas + ' novidade(s)</b> ainda não comunicada(s) ao cliente</div>';
          } else {
            html += '<div style="margin:6px 0;color:#16A34A">✅ Cliente em dia com as novidades</div>';
          }
          (r.novidades || []).slice(0, 3).forEach(function (n) {
            html += '<div style="margin:2px 0;color:#555">• ' + esc((n.event_date || '') + ' ' + (n.title || '').slice(0, 80)) + '</div>';
          });
          html += '<button id="cbc-bot-copy" style="margin-top:8px;width:100%;padding:6px;background:#1B3A5C;color:#fff;border:none;border-radius:6px;cursor:pointer">📋 Copiar resposta pronta</button>';
          html += '<button id="cbc-bot-done" style="margin-top:4px;width:100%;padding:5px;background:#fff;color:#1B3A5C;border:1px solid #1B3A5C;border-radius:6px;cursor:pointer">✔ Marcar como comunicado</button>';
          renderBox(html);
          $('#cbc-bot-copy').on('click', function () {
            var ta = document.createElement('textarea');
            ta.value = r.resposta_pronta || '';
            document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); $(this).text('✅ Copiado!'); } catch (e) { /* sem clipboard */ }
            document.body.removeChild(ta);
          });
          $('#cbc-bot-done').on('click', function () {
            $.ajax({
              url: url + '?key=' + encodeURIComponent(key), method: 'POST', contentType: 'application/json',
              data: JSON.stringify({ action: 'mark_communicated', lawsuit_id: (r.lawsuit_ids || [])[0] }),
              success: function () { load(); },
            });
          });
        },
        error: function (xhr) {
          renderBox('<b>⚖️ Bot ADVBOX</b><br><span style="color:#c00">falha ao consultar (' + xhr.status + ')</span>');
        },
      });
    }

    this.callbacks = {
      render: function () {
        if (self.system().area === 'lcard') load();
        return true;
      },
      init: function () { return true; },
      bind_actions: function () { return true; },
      settings: function () { return true; },
      onSave: function () { return true; },
      destroy: function () { $('#cbc-bot-widget').remove(); },
    };
    return this;
  };
  return CustomWidget;
});

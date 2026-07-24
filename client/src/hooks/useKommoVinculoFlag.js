// Hook do feature flag "kommo_vinculo": le bot_config.kommo_vinculo e resolve
// contra o e-mail do usuario logado. Off por padrao (config ausente => form atual).
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../AuthContext';
import { resolveFlag } from '../utils/kommoVinculoFlag';

export function useKommoVinculoFlag() {
  const { user } = useAuth();
  const [ativo, setAtivo] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const { data } = await supabase
          .from('bot_config')
          .select('value')
          .eq('key', 'kommo_vinculo')
          .maybeSingle();
        if (vivo) setAtivo(resolveFlag(data?.value, user?.email));
      } catch {
        if (vivo) setAtivo(false); // qualquer erro => flag off (form atual)
      } finally {
        if (vivo) setLoading(false);
      }
    })();
    return () => { vivo = false; };
  }, [user?.email]);

  return { ativo, loading };
}

import { useState } from 'react';
import { useTesesAuth } from '../contexts/AuthContext';
import { Button, Input, Label, Spinner } from '../components/ui/Primitives';
import { supabaseConfigWarning } from '../lib/supabaseClient';

export default function LoginPage() {
  const { signInWithGoogle, signInWithEmail, loading, error } = useTesesAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const warning = supabaseConfigWarning();

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await signInWithEmail(email, password);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-slate-900 text-white px-8 py-6 text-center">
          <div className="text-[10px] tracking-[3px] text-slate-400 font-bold">CBC</div>
          <div className="text-2xl font-bold mt-1">TESES</div>
          <div className="text-[11px] text-slate-400 mt-1">Gestão de modelos e petições</div>
        </div>
        <div className="px-8 py-7">
          {warning && (
            <div className="mb-4 rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
              {warning}
            </div>
          )}
          {error && (
            <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            className="w-full mb-4"
            onClick={signInWithGoogle}
            disabled={loading || busy}
          >
            <span>🔐</span>
            Entrar com Google
          </Button>

          <div className="flex items-center gap-2 my-3 text-[10px] text-slate-400">
            <span className="flex-1 border-t border-slate-200" />
            ou com e-mail
            <span className="flex-1 border-t border-slate-200" />
          </div>

          <form onSubmit={submit} className="space-y-3">
            <div>
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@cbcadvogados.com.br"
                required
              />
            </div>
            <div>
              <Label htmlFor="pwd">Senha</Label>
              <Input
                id="pwd"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Spinner /> : 'Entrar'}
            </Button>
          </form>

          <p className="mt-5 text-[10px] text-slate-400 text-center">
            Apenas contas autorizadas do escritório.
          </p>
        </div>
      </div>
    </div>
  );
}

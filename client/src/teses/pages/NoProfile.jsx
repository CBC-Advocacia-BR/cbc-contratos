import { Button } from '../components/ui/Primitives';
import { useTesesAuth } from '../contexts/AuthContext';

export default function NoProfilePage() {
  const { session, signOut } = useTesesAuth();
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-7 text-center">
        <div className="text-[10px] tracking-[3px] text-slate-400 font-bold">CBC TESES</div>
        <h1 className="text-xl font-bold text-slate-800 mt-2">Aguardando liberação</h1>
        <p className="text-sm text-slate-600 mt-3">
          Sua conta <strong>{session?.user?.email}</strong> ainda não foi vinculada a um perfil de uso.
          Solicite ao administrador do sistema a criação do seu perfil (admin, coordenador, especialista ou operacional).
        </p>
        <Button variant="outline" className="mt-5" onClick={signOut}>
          Sair
        </Button>
      </div>
    </div>
  );
}

import { Card, CardBody, CardHeader } from '../components/ui/Primitives';
import { SUPABASE_CONFIGURED } from '../lib/supabaseClient';
import { API_URL } from '../../config';

export default function SettingsPage() {
  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Configurações do sistema</h1>
        <p className="text-xs text-slate-500">Variáveis de ambiente e integrações.</p>
      </div>

      <Card>
        <CardHeader title="Supabase" />
        <CardBody className="text-xs text-slate-700 space-y-1">
          <div><strong>VITE_SUPABASE_URL:</strong> {import.meta.env.VITE_SUPABASE_URL ? '✅ definido' : '⚠ ausente'}</div>
          <div><strong>VITE_SUPABASE_ANON_KEY:</strong> {import.meta.env.VITE_SUPABASE_ANON_KEY ? '✅ definido' : '⚠ ausente'}</div>
          <div><strong>Status:</strong> {SUPABASE_CONFIGURED ? 'Conectado' : 'Usando stub local'}</div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Backend proxy (Advbox / DataJud)" />
        <CardBody className="text-xs text-slate-700 space-y-2">
          <div><strong>API_URL:</strong> {API_URL}</div>
          <div className="text-slate-500">
            As chamadas à Advbox passam pelo endpoint <code>/api/teses/advbox/*</code> e as do DataJud por <code>/api/teses/datajud</code>.
            Defina <code>ADVBOX_BEARER_TOKEN</code> e <code>DATAJUD_API_KEY</code> no backend.
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Storage" />
        <CardBody className="text-xs text-slate-700">
          <div className="text-slate-500">
            Buckets sugeridos no Supabase Storage:
            <ul className="list-disc ml-5 mt-1">
              <li><code>teses-models</code> — modelos Word importados</li>
              <li><code>teses-generated</code> — petições geradas</li>
              <li><code>teses-assets</code> — timbrado, logos, assinaturas</li>
            </ul>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Timbrado" />
        <CardBody className="text-xs text-slate-700">
          O timbrado oficial ainda não foi fornecido. A geração de DOCX atualmente usa um cabeçalho/rodapé
          placeholder definido em <code>client/src/teses/lib/docxGenerator.js</code>.
          Ao receber o arquivo oficial, substitua os blocos <code>Header</code> e <code>Footer</code>
          com a imagem/texto correto.
        </CardBody>
      </Card>
    </div>
  );
}

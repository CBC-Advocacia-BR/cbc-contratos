// Reusable Skeleton loading components
export function SkeletonCard({ lines = 3 }) {
  return (
    <div className="card p-4 space-y-3">
      <div className="skeleton h-4 w-1/3" />
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton h-3" style={{ width: `${80 - i * 15}%` }} />
      ))}
    </div>
  );
}

export function SkeletonStat() {
  return (
    <div className="p-4 rounded-xl bg-white border border-gray-200">
      <div className="skeleton h-3 w-20 mb-2" />
      <div className="skeleton h-7 w-16" />
    </div>
  );
}

// (#28) Skeleton for bar chart
export function SkeletonChart() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="skeleton h-3 w-32 mb-3" />
      <div className="space-y-2">
        {[90, 70, 55, 40, 25].map((w, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="skeleton h-3 w-24 shrink-0" />
            <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
              <div className="skeleton h-full rounded-full" style={{ width: `${w}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// (#28) Skeleton for trend line
export function SkeletonTrend() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-2">
        <div className="skeleton h-3 w-40" />
        <div className="skeleton h-4 w-24 rounded-full" />
      </div>
      <div className="skeleton h-24 w-full rounded-lg" />
      <div className="flex justify-between mt-2">
        {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="skeleton h-2 w-8" />)}
      </div>
    </div>
  );
}

// (#28) Skeleton for distribution card
export function SkeletonDistribution() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="skeleton h-3 w-64 mb-4" />
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="text-center p-3 rounded-lg bg-gray-50">
            <div className="skeleton h-7 w-10 mx-auto mb-1" />
            <div className="skeleton h-2 w-14 mx-auto" />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {[80, 65, 50, 40].map((w, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="skeleton h-3 w-32 shrink-0" />
            <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
              <div className="skeleton h-full rounded-full" style={{ width: `${w}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// (#28) Skeleton for insights
export function SkeletonInsights() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="skeleton h-4 w-4 rounded" />
        <div className="skeleton h-3 w-32" />
      </div>
      <div className="space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="skeleton h-14 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export function SkeletonTable({ rows = 5 }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-3 p-3 rounded-lg bg-gray-50">
          <div className="skeleton h-4 w-1/4" />
          <div className="skeleton h-4 w-1/5" />
          <div className="skeleton h-4 w-1/6" />
          <div className="skeleton h-4 w-1/8" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonDashboard() {
  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6 bg-gray-50">
      {/* Filters skeleton */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="skeleton h-3 w-16 mb-3" />
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton h-9 flex-1 rounded-lg" />)}
        </div>
      </div>
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map(i => <SkeletonStat key={i} />)}
      </div>
      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <SkeletonChart />
        <SkeletonChart />
      </div>
      {/* Trend */}
      <SkeletonTrend />
      {/* Distribution */}
      <SkeletonDistribution />
      {/* Insights */}
      <SkeletonInsights />
    </div>
  );
}

export function SkeletonContratosTab() {
  return (
    <div className="p-4 space-y-3">
      <div className="flex gap-2 mb-4">
        <div className="skeleton h-10 flex-1" />
        <div className="skeleton h-10 w-24" />
      </div>
      <SkeletonTable rows={6} />
    </div>
  );
}

// (#96) Skeleton para MonitorPanel — simula filas + erros + cards de health
export function SkeletonMonitor() {
  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header + health cards */}
      <div className="bg-white border-b border-gray-100 p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="skeleton h-5 w-48 mb-2" />
            <div className="skeleton h-3 w-56" />
          </div>
          <div className="flex gap-2">
            <div className="skeleton h-8 w-20 rounded-lg" />
            <div className="skeleton h-8 w-24 rounded-lg" />
          </div>
        </div>
        <div className="grid grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="skeleton h-3 w-20" />
                <div className="skeleton h-3 w-12 rounded-full" />
              </div>
              <div className="skeleton h-7 w-16" />
            </div>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-4">
            {/* Filas */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="skeleton h-3 w-32 mb-3" />
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="skeleton h-4 w-4 rounded" />
                      <div className="skeleton h-3 w-32" />
                    </div>
                    <div className="skeleton h-5 w-6" />
                  </div>
                ))}
              </div>
            </div>
            {/* Erros */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="skeleton h-3 w-40 mb-3" />
              <div className="space-y-1.5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="skeleton h-7 w-full rounded-lg" />
                ))}
              </div>
            </div>
            {/* Capacidade */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="skeleton h-3 w-36 mb-3" />
              <div className="space-y-1.5">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="skeleton h-7 w-full rounded-lg" />
                ))}
              </div>
            </div>
          </div>
          <div className="space-y-4">
            {/* Historico automacoes */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="skeleton h-3 w-44 mb-3" />
              <div className="space-y-1">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="skeleton h-7 w-full rounded-lg" />
                ))}
              </div>
            </div>
            {/* Atividade */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="skeleton h-3 w-36 mb-3" />
              <div className="space-y-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="skeleton h-8 w-full rounded-lg" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// (#96) Skeleton para IntegracoesPanel — cards de servicos + tabela
export function SkeletonIntegracoes() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
      <div className="flex bg-white border-b border-gray-200 shrink-0">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex-1 py-3 flex justify-center">
            <div className="skeleton h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-4xl mx-auto space-y-4">
          {/* Stats cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl p-4 border border-gray-100">
                <div className="flex items-center gap-2 mb-1">
                  <div className="skeleton h-5 w-5 rounded" />
                  <div className="skeleton h-2.5 w-20" />
                </div>
                <div className="skeleton h-8 w-12 mb-2" />
                <div className="skeleton h-1.5 w-full rounded-full" />
              </div>
            ))}
          </div>
          {/* Titulo */}
          <div className="skeleton h-4 w-40 mt-4" />
          {/* Integration cards */}
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl p-4 border border-gray-100">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="skeleton h-2 w-2 rounded-full" />
                      <div className="skeleton h-3.5 w-64" />
                    </div>
                    <div className="skeleton h-2.5 w-80 mb-2 ml-4" />
                    <div className="flex items-center gap-3 ml-4">
                      <div className="skeleton h-4 w-24 rounded" />
                      <div className="skeleton h-3 w-48" />
                    </div>
                  </div>
                  <div className="skeleton h-5 w-16 rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// (#96) Skeleton para AdminPanel — tabela de usuarios
export function SkeletonAdmin() {
  return (
    <div className="h-full flex flex-col bg-white">
      <div className="p-5 border-b border-gray-100">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="skeleton h-5 w-64 mb-2" />
            <div className="skeleton h-3 w-80" />
          </div>
          <div className="skeleton h-8 w-40 rounded-lg" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="bg-gray-50 border-b border-gray-100 px-4 py-3 flex gap-4">
            <div className="skeleton h-3 w-24" />
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="skeleton h-3 flex-1" />
            ))}
            <div className="skeleton h-3 w-14" />
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="border-b border-gray-50 px-4 py-3 flex items-center gap-4">
              <div className="w-24">
                <div className="skeleton h-3.5 w-20 mb-1" />
                <div className="skeleton h-2.5 w-24" />
              </div>
              {Array.from({ length: 7 }).map((_, j) => (
                <div key={j} className="flex-1 flex justify-center">
                  <div className="skeleton h-4 w-4 rounded" />
                </div>
              ))}
              <div className="w-14" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// (#96) Skeleton para LeadsTab — dashboard + tabela
export function SkeletonLeads() {
  return (
    <div className="flex-1 overflow-y-auto bg-gray-50">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 md:px-6">
        <div className="flex items-center justify-between py-3">
          <div>
            <div className="skeleton h-6 w-32 mb-1" />
            <div className="skeleton h-3 w-48" />
          </div>
          <div className="flex gap-2">
            <div className="skeleton h-4 w-32" />
            <div className="skeleton h-7 w-24 rounded-lg" />
          </div>
        </div>
        <div className="flex gap-1 pb-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton h-7 w-32 rounded" />
          ))}
        </div>
      </div>
      <div className="p-4 md:p-6 space-y-4">
        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonStat key={i} />)}
        </div>
        {/* Charts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <SkeletonChart />
          <SkeletonChart />
        </div>
        {/* Tabela */}
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="skeleton h-3 w-48 mb-3" />
          <SkeletonTable rows={5} />
        </div>
      </div>
    </div>
  );
}

// (#96) Skeleton para BoletosPanel — stats + lista customers
export function SkeletonBoletos() {
  return (
    <div className="h-full flex flex-col bg-white">
      {/* Toolbar */}
      <div className="border-b border-gray-100 p-3 md:p-4 space-y-2.5 bg-white">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-100 p-3">
              <div className="skeleton h-3 w-16 mb-2" />
              <div className="skeleton h-6 w-24" />
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <div className="skeleton h-9 flex-1 rounded-lg" />
          <div className="skeleton h-9 w-28 rounded-lg" />
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-7 w-24 rounded-full shrink-0" />
          ))}
        </div>
      </div>
      {/* Customer list */}
      <div className="flex-1 overflow-y-auto bg-gray-50 p-3 md:p-4 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-3">
            <div className="flex items-center gap-3">
              <div className="skeleton h-10 w-10 rounded-full shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="skeleton h-3.5 w-48 mb-1.5" />
                <div className="skeleton h-2.5 w-36" />
              </div>
              <div className="text-right shrink-0">
                <div className="skeleton h-4 w-24 mb-1 ml-auto" />
                <div className="skeleton h-2.5 w-16 ml-auto" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// (#96) Skeleton para AsaasPanel — similar a BoletosPanel mas com tabela de contratos
export function SkeletonAsaas() {
  return (
    <div className="h-full flex flex-col bg-white">
      {/* Toolbar */}
      <div className="border-b border-gray-100 p-3 md:p-4 space-y-2 bg-white">
        <div className="flex gap-2 items-center">
          <div className="skeleton h-9 flex-1 rounded-lg" />
          <div className="skeleton h-9 w-24 rounded-lg" />
          <div className="skeleton h-9 w-28 rounded-lg" />
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-7 w-24 rounded-full shrink-0" />
          ))}
        </div>
      </div>
      {/* Tabela */}
      <div className="flex-1 overflow-y-auto bg-gray-50 p-3 md:p-4">
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          {/* Header */}
          <div className="bg-gray-50 border-b border-gray-100 px-3 py-2.5 flex gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton h-3 flex-1" />
            ))}
          </div>
          {/* Rows */}
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="border-b border-gray-50 px-3 py-3 flex items-center gap-3">
              <div className="skeleton h-8 w-8 rounded-full shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="skeleton h-3.5 w-48 mb-1.5" />
                <div className="skeleton h-2.5 w-32" />
              </div>
              <div className="skeleton h-3 w-20" />
              <div className="skeleton h-3 w-16" />
              <div className="skeleton h-3 w-20" />
              <div className="skeleton h-6 w-20 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

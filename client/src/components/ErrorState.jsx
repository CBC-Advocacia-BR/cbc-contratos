// Componente reutilizavel para exibir estados de erro amigaveis
// Props:
//   title: titulo principal do erro (string curta)
//   message: mensagem descritiva
//   suggestion: sugestao de acao ao usuario
//   onRetry: callback para botao de tentar novamente
//   icon: emoji ou ReactNode (default warning)
//   inline: boolean — formato inline (menor, sem padding grande)
export default function ErrorState({
  title = 'Algo deu errado',
  message,
  suggestion,
  onRetry,
  icon,
  inline = false,
}) {
  const displayIcon = icon !== undefined ? icon : (
    <svg className='w-10 h-10' fill='none' stroke='currentColor' viewBox='0 0 24 24' aria-hidden='true'>
      <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={1.5}
        d='M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' />
    </svg>
  );

  if (inline) {
    return (
      <div className='flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg' role='alert'>
        <span className='shrink-0 text-red-500' aria-hidden='true'>
          {typeof displayIcon === 'string' ? <span className='text-xl'>{displayIcon}</span> : displayIcon}
        </span>
        <div className='flex-1 min-w-0'>
          <div className='text-xs font-bold text-red-700'>{title}</div>
          {message && <div className='text-[11px] text-red-600 mt-0.5'>{message}</div>}
          {suggestion && <div className='text-[10px] text-red-500/80 mt-1'>{suggestion}</div>}
          {onRetry && (
            <button
              onClick={onRetry}
              className='mt-2 px-3 py-1 text-[10px] font-bold uppercase rounded-md bg-red-500 text-white hover:bg-red-600 cursor-pointer transition-colors'
            >
              Tentar novamente
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className='flex flex-col items-center justify-center text-center p-6 md:p-8 max-w-md mx-auto' role='alert'>
      <div className='text-red-400 mb-3' aria-hidden='true'>
        {typeof displayIcon === 'string' ? (
          <span className='text-5xl'>{displayIcon}</span>
        ) : (
          <div className='w-12 h-12 rounded-full bg-red-50 border border-red-200 flex items-center justify-center text-red-500'>
            {displayIcon}
          </div>
        )}
      </div>
      <h3 className='text-sm md:text-base font-bold text-gray-800 mb-1'>{title}</h3>
      {message && <p className='text-xs md:text-sm text-gray-600 mb-2'>{message}</p>}
      {suggestion && (
        <p className='text-[11px] md:text-xs text-gray-400 mb-4 italic'>{suggestion}</p>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className='px-4 py-2 text-xs font-bold uppercase rounded-lg cursor-pointer transition-all hover:opacity-90 text-white flex items-center gap-2'
          style={{ background: '#1B3A5C' }}
        >
          <svg className='w-3.5 h-3.5' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
            <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2}
              d='M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' />
          </svg>
          Tentar novamente
        </button>
      )}
    </div>
  );
}

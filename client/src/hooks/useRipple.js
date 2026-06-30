// (#22) useRipple — captura posição do clique e define CSS vars para ripple radial.
// Uso: <button className="btn-ripple" onMouseDown={useRipple()}>...</button>
// Se o hook não for usado, o ripple ainda funciona mas sai sempre do centro.
export function useRipple() {
  return (e) => {
    const el = e.currentTarget;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    el.style.setProperty('--ripple-x', `${x}%`);
    el.style.setProperty('--ripple-y', `${y}%`);
  };
}

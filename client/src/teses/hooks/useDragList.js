// Hook mínimo para reordenação via HTML5 drag-and-drop nativo.
//
// Uso:
//   const dnd = useDragList(items, setItems, (a, b) => a.id === b.id);
//   <div draggable {...dnd.getItemProps(item)} />

import { useRef } from 'react';

export function useDragList(items, setItems, keyFn = (x) => x.id) {
  const dragging = useRef(null);

  const getItemProps = (item) => ({
    draggable: true,
    onDragStart: (e) => {
      dragging.current = keyFn(item);
      e.dataTransfer.effectAllowed = 'move';
      e.currentTarget.classList.add('opacity-50');
    },
    onDragEnd: (e) => {
      dragging.current = null;
      e.currentTarget.classList.remove('opacity-50');
    },
    onDragOver: (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    },
    onDrop: (e) => {
      e.preventDefault();
      const fromKey = dragging.current;
      const toKey = keyFn(item);
      if (!fromKey || fromKey === toKey) return;
      const current = [...items];
      const from = current.findIndex((x) => keyFn(x) === fromKey);
      const to = current.findIndex((x) => keyFn(x) === toKey);
      if (from < 0 || to < 0) return;
      const [moved] = current.splice(from, 1);
      current.splice(to, 0, moved);
      setItems(current);
    },
  });

  return { getItemProps };
}

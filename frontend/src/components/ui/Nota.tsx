// A nota pequena e apagada: "Carregando valores…", "3 de 40", "1-20 de 98.194 linhas", o
// aviso de que a busca vale só sobre a fatia carregada.

import type { ReactNode } from 'react';

export function Nota({
  children,
  como: Tag = 'span',
}: {
  children: ReactNode;
  como?: 'span' | 'p';
}) {
  return <Tag className="text-[0.66rem] text-pbi-muted">{children}</Tag>;
}

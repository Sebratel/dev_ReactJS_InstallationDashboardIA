// Barreira de erro por visual: isola exceções de renderização para que um visual com
// erro não desmonte os outros da página. (Marco A, A4)

import { Component, type ErrorInfo, type ReactNode } from 'react';
import type { VisualCalculado } from '../api.ts';
import { Cartao, Erro, alturaDoConteudo } from './Cartao.tsx';
import { tituloDoVisual } from '../rotulos.ts';

interface Props {
  visual: VisualCalculado;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  erro: string | null;
}

export class VisualErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, erro: null };
  }

  static getDerivedStateFromError(error: unknown): State {
    const msg = error instanceof Error ? error.message : String(error);
    return { hasError: true, erro: msg };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(`[VisualErrorBoundary] Erro no visual ${this.props.visual.id}:`, error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      const titulo = tituloDoVisual(this.props.visual);
      const altura = alturaDoConteudo(this.props.visual.conteudo);
      return (
        <Cartao titulo={titulo} sub="erro de renderização" id={this.props.visual.id} altura={altura}>
          <Erro>{this.state.erro ?? 'Falha ao renderizar este visual.'}</Erro>
        </Cartao>
      );
    }
    return this.props.children;
  }
}

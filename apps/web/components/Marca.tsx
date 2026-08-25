/**
 * A marca, em SVG inline.
 *
 * Inline e não `<img>` por um motivo só: assim ela herda a cor do tema. O
 * arquivo em `public/brand` continua sendo a fonte para exportar PNG e para os
 * portais que exigem imagem — este componente é a versão que vive na tela.
 *
 * O desenho é o mesmo da Fase 0: três commits entram de um lado, um post sai
 * do outro. Aqui o fundo é transparente, porque a marca aparece sobre a
 * superfície da aplicação e não sobre o quadrado do ícone.
 */

export function Marca({ tamanho = 28 }: { tamanho?: number }) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={tamanho}
      height={tamanho}
      role="img"
      aria-label="CommitPost"
      focusable="false"
    >
      {/* A linha e os nós: o histórico de commits. */}
      <path
        d="M24 27 V93"
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        opacity="0.45"
      />
      <g fill="var(--acao)">
        <circle cx="24" cy="32" r="8.5" />
        <circle cx="24" cy="60" r="8.5" />
        <circle cx="24" cy="88" r="8.5" />
      </g>

      {/* O card: o post que sai. */}
      <rect x="50" y="28" width="54" height="64" rx="11" fill="currentColor" />
      <g fill="var(--fundo)">
        <rect x="61" y="45" width="32" height="7" rx="3.5" />
        <rect x="61" y="58" width="32" height="7" rx="3.5" />
        <rect x="61" y="71" width="19" height="7" rx="3.5" />
      </g>
    </svg>
  );
}

export default function Home() {
  return (
    <main>
      <h1>CommitPost</h1>
      <p>
        Este app hospeda apenas o que precisa ser HTTP público: o webhook do
        Telegram, o painel de edição e o callback do OAuth do LinkedIn.
      </p>
      <p>
        O pipeline de coleta, filtro e geração roda no runner do GitHub Actions.
      </p>
    </main>
  );
}

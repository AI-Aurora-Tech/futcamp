// Ajuda mínima para os testes de regras: sem framework (o projeto não tem um).
// O esbuild, que já vem com o Vite, empacota `tests/todos.test.ts` e o Node o
// executa; sai com código 1 se algo falhar.
let falhas = 0

export function ok(rotulo: string, condicao: boolean): void {
  if (!condicao) falhas++
  console.log(condicao ? '✅' : '❌', rotulo)
}

export function fim(): void {
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\ntodos passaram')
  process.exit(falhas ? 1 : 0)
}

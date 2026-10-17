// Временно: сами шрифты ещё не подключены (шаг 5а), поэтому браузер показывает
// похожие системные. На шаге 5а этот файл заменит конфиг self-hosted шрифтов
// (id, название, файл woff2), общий для редактора и PDF.
const families: Record<string, string> = {
  caveat: "Caveat, 'Segoe Print', cursive",
  'marck-script': "'Marck Script', 'Segoe Script', cursive",
  pacifico: "Pacifico, 'Segoe Script', cursive",
  lobster: "Lobster, 'Segoe Script', cursive",
  'playfair-display': "'Playfair Display', Georgia, serif",
  lora: 'Lora, Georgia, serif',
  'pt-serif': "'PT Serif', Georgia, serif",
  montserrat: 'Montserrat, system-ui, sans-serif',
  raleway: 'Raleway, system-ui, sans-serif',
  nunito: 'Nunito, system-ui, sans-serif',
}

export function fontFamily(id: string): string {
  return families[id] ?? 'system-ui, sans-serif'
}

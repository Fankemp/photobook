// Русские формы множественного числа: 1 страница, 2 страницы, 5 страниц.
// Intl.PluralRules знает правила языка, нам остаётся дать три формы.
const rules = new Intl.PluralRules('ru')

export function plural(n: number, [one, few, many]: [string, string, string]): string {
  switch (rules.select(n)) {
    case 'one':
      return one
    case 'few':
      return few
    default:
      return many
  }
}

// Дали клиентот/добавувачот е од Македонија (празна држава = домашен)
export function isDomesticCountry(c?: string | null): boolean {
  return !c || /^(mk|mkd|македонија|северна македонија|република (северна )?македонија|(north |republic of (north )?)?macedonia|makedonija|severna makedonija)$/i.test(String(c).trim());
}

import { readFileSync, writeFileSync } from 'node:fs'

const text = readFileSync('data/sources/minervini/charts-pdf.md', 'utf8')
const pattern = /\b([A-Z]{1,5}) broke out through \$([\d.]+) on ([A-Z][a-z]+ \d{1,2}, \d{4})/g
const seen = new Set()
const cases = []
for (const m of text.matchAll(pattern)) {
  const [, symbol, price, when] = m
  const date = new Date(`${when} UTC`).toISOString().slice(0, 10)
  const key = `${symbol}:${date}`
  if (seen.has(key)) continue
  seen.add(key)
  cases.push({ symbol, date, price: Number(price), label: 'winner' })
}
// Second phrasing used in the same document: "broke out on 7/13/22 through a price of $7".
const numeric = /\b([A-Z]{2,5}) broke out (?:on big volume )?on (\d{1,2})\/(\d{1,2})\/(\d{2}),? through[^$]{0,40}\$([\d.]+)/g
for (const m of text.matchAll(numeric)) {
  const [, symbol, month, day, year, price] = m
  const date = `20${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  const key = `${symbol}:${date}`
  if (seen.has(key)) continue
  seen.add(key)
  cases.push({ symbol, date, price: Number(price), label: 'winner' })
}
writeFileSync('tests/eval/cases.json', `${JSON.stringify(cases, null, 2)}\n`)
console.log(`${cases.length} cases`)

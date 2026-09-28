import { ref, watch } from 'vue'
import { subjectNames, type Subject, type Language } from '../shared/domain'
const storageKey = 'science-language'
function savedLanguage(): Language {
  try { return localStorage.getItem(storageKey) === 'cs' ? 'cs' : 'en' } catch { return 'en' }
}
// This device's preference never changes team progress or answer grading.
export const language = ref<Language>(savedLanguage())
watch(language, value => {
  document.documentElement.lang = value
  document.title = value === 'cs' ? 'Otázky' : 'Questions'
  try { localStorage.setItem(storageKey, value) } catch { /* The switch still works when storage is unavailable. */ }
}, { immediate: true })
const czech: Record<string, string> = {
  'Waiting for the admin to start.': 'Čekáme na zahájení správcem.',
  'Time is up.': 'Čas vypršel.',
  'The competition has already started. Reset it before starting again.': 'Soutěž už začala. Před dalším zahájením ji resetujte.',

  "Questions": "Otázky",
  "Game": "Hra",
  "Standings": "Pořadí",
  "Research": "Výzkum",
  "Leave": "Odhlásit se",
  "Main": "Hlavní nabídka",
  "Subjects": "Předměty",
  "Team code": "Kód týmu",
  "Joining…": "Připojování…",
  "Join": "Připojit se",
  "Admin": "Správa",
  "Competition over.": "Soutěž skončila.",
  "Waiting for the start…": "Čekáme na zahájení…",
  "Loading…": "Načítání…",
  "Reconnecting…": "Obnovování spojení…",
  "Booklet": "Datová příručka",
  " (opens in a new tab)": " (otevře se v nové kartě)",
  "Choose an answer": "Vyberte odpověď",
  "Your answer": "Vaše odpověď",
  "Number only; use a decimal point or comma.": "Pouze číslo; desetinná tečka i čárka jsou povoleny.",
  "Checking…": "Kontrola…",
  "Submit answer": "Odeslat odpověď",
  "Scoring": "Bodování",
  "Correct on try 1: +10. Try 2: 0. Every submission from try 3: −5, including incorrect answers.": "Správně na 1. pokus: +10. Na 2. pokus: 0. Každé odeslání od 3. pokusu: −5, i za nesprávnou odpověď.",
  "Correct on try 1: {full}. Try 2: {half}. Later: 0.": "Správně na 1. pokus: {full}. Na 2. pokus: {half}. Později: 0.",
  "Skip question": "Přeskočit otázku",
  "{count} team skips left": "Zbývající přeskočení pro tým: {count}",
  "Skip this question? You cannot return to it.": "Přeskočit tuto otázku? Už se k ní nelze vrátit.",
  "Yes, skip": "Ano, přeskočit",
  "Keep trying": "Pokračovat v řešení",
  "Track complete": "Dokončeno",
  "Question {number} of {total}": "Otázka {number} z {total}",
  "{subject} complete.": "{subject}: dokončeno.",
  "Skipped": "Přeskočeno",
  "Correct": "Správně",
  "Try again": "Zkuste to znovu",
  "Frozen for the final 5 minutes.": "Pořadí je na posledních 5 minut zmrazené.",
  "Diamond scores": "Počty diamantů",
  "Team": "Tým",
  "Diamonds": "Diamanty",
  " (you)": " (vy)",
  "Mine 1 diamond": "Vytěžit 1 diamant",
  "{count} left here": "Zde zbývá: {count}",
  "Move: 1 Research. Mining is free. Most diamonds wins.": "Pohyb: 1 bod výzkumu. Těžba je zdarma. Vyhrává nejvíc diamantů.",
  "Shared game board": "Společná herní plocha",
  "Column {x}, row {y}": "Sloupec {x}, řádek {y}",
  ", move here": ", přesunout sem",
  "Time remaining: {time}": "Zbývající čas: {time}",
  "Login": "Přihlášení",
  "Sign out": "Odhlásit se",
  "Admin password": "Heslo správce",
  "Sign in": "Přihlásit se",
  "Teams": "Týmy",
  "Add team": "Přidat tým",
  "Start game": "Zahájit hru",
  "Finished": "Ukončeno",
  "Running": "Probíhá",
  "Team name": "Název týmu",
  "Age category": "Věková kategorie",
  "Login code": "Přihlašovací kód",
  "Auto-generate": "Vygenerovat automaticky",
  "Save team": "Uložit tým",
  "Create team": "Vytvořit tým",
  "Cancel": "Zrušit",
  "Delete team": "Smazat tým",
  "Age": "Věk",
  "Code": "Kód",
  "Progress": "Postup",
  "Actions": "Akce",
  "Question score": "Body za otázky",
  "Skips used": "Použitá přeskočení",
  "Edit": "Upravit",
  "No teams yet.": "Zatím žádné týmy.",
  "Reset competition…": "Resetovat soutěž…",
  "Clear progress, scores and positions, and refill diamonds; return everyone to the waiting screen. Teams stay.": "Vymazat postup, skóre a pozice, doplnit diamanty a vrátit všechny na čekací obrazovku. Týmy zůstanou.",
  "Type RESET to confirm.": "Pro potvrzení napište RESET.",
  "Confirm reset": "Potvrdit reset",
  "Changing age category resets this team’s progress, Research, skips, diamonds and position. Continue?": "Změna věkové kategorie resetuje postup tohoto týmu, výzkum, přeskočení, diamanty a pozici. Pokračovat?",
  "Delete {name} and all its progress? This cannot be undone.": "Smazat tým {name} a veškerý jeho postup? Toto nelze vrátit.",
  "Cannot reach the server. Check your connection and try again.": "Server není dostupný. Zkontrolujte připojení a zkuste to znovu.",
  "Something went wrong. Try again.": "Něco se nepovedlo. Zkuste to znovu.",
  "Could not sign out. Try again.": "Odhlášení se nezdařilo. Zkuste to znovu.",
  "Request failed.": "Požadavek se nezdařil.",
  "Invalid request origin.": "Neplatný původ požadavku.",
  "Too many login attempts. Wait a minute and try again.": "Příliš mnoho pokusů o přihlášení. Počkejte minutu a zkuste to znovu.",
  "Please sign in again.": "Přihlaste se prosím znovu.",
  "Team not found.": "Tým nebyl nalezen.",
  "Could not generate a code. Try again.": "Kód se nepodařilo vygenerovat. Zkuste to znovu.",
  "That code was not found. Check it and try again.": "Kód nebyl nalezen. Zkontrolujte ho a zkuste to znovu.",
  "Incorrect password.": "Nesprávné heslo.",
  "A teammate has already advanced this subject. The latest question is now shown.": "Spoluhráč už v tomto předmětu postoupil. Nyní vidíte aktuální otázku.",
  "Your team has used all three skips.": "Váš tým už využil všechna tři přeskočení.",
  "Enter an answer first.": "Nejprve zadejte odpověď.",
  "Choose one answer.": "Vyberte jednu odpověď.",
  "Enter a number without units, using a decimal point or comma if needed.": "Zadejte číslo bez jednotek. Můžete použít desetinnou tečku nebo čárku.",
  "Endpoint not found.": "Požadovaná adresa nebyla nalezena.",
  "That code is already used by another team.": "Tento kód už používá jiný tým.",
  "Invalid JSON request.": "Neplatný požadavek JSON.",
  "The server could not complete this request. Please try again.": "Server nemohl požadavek dokončit. Zkuste to prosím znovu.",
  "Your team has already moved. Choose a square again.": "Váš tým se už přesunul. Vyberte políčko znovu.",
  "Choose a neighbouring square.": "Vyberte sousední políčko.",
  "You need 1 Research to move.": "K pohybu potřebujete 1 bod výzkumu.",
  "Your team has moved. Mine at your current square.": "Váš tým se přesunul. Těžte na aktuálním políčku.",
  "No diamonds left here.": "Zde už žádné diamanty nejsou."
}
export function t(english: string, values: Record<string, string | number> = {}): string {
  const text = language.value === 'cs' ? czech[english] ?? english : english
  return text.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match))
}
const czechSubjects: Record<Subject, string> = { physics: 'Fyzika', 'computer-science': 'Informatika', biology: 'Biologie', chemistry: 'Chemie', ess: 'ESS' }
export const subjectLabel = (subject: Subject) => language.value === 'cs' ? czechSubjects[subject] : subjectNames[subject]
export function diamonds(count: number): string {
  if (language.value === 'en') return `${count} ${count === 1 ? 'diamond' : 'diamonds'}`
  return `${count} ${count === 1 ? 'diamant' : count >= 2 && count <= 4 ? 'diamanty' : 'diamantů'}`
}

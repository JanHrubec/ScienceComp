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
  "Scores": "Skóre",
  "Team": "Tým",
  "Score": "Skóre",
  " (you)": " (vy)",
  "Out of Research! Answer questions to refuel.": "Došel výzkum! Odpovídejte na otázky a doplňte palivo.",
  "Sailing to a school: {tiles} to go": "Pluje k hejnu: zbývá {tiles}",
  "Sailing: {tiles} to go": "Pluje: zbývá {tiles}",
  "Fishing! Next catch in {seconds} s": "Loví! Další úlovek za {seconds} s",
  "Idle. Tap a school on the map to send your boat.": "Kotví. Klepnutím na hejno v mapě tam pošlete svou loď.",
  "Golden school: {fish}, swims off in {time}": "Zlaté hejno: {fish}, odpluje za {time}",
  "School: {fish}": "Hejno: {fish}",
  "A golden school has appeared!": "Objevilo se zlaté hejno!",
  "A golden school swam off.": "Zlaté hejno odplulo.",
  "You caught a golden fish! +{points}": "Ulovili jste zlatou rybu! +{points}",
  "{team} caught a golden fish!": "Zlatou rybu ulovil tým {team}!",
  "{fish} + {bonus} golden": "{fish} + {bonus} za zlaté",
  "Fuel": "Palivo",
  "Sending…": "Odesílání…",
  "Research; {cost} per tile": "výzkum; {cost} za políčko",
  "Go to questions": "K otázkám",
  "Map. Use the list of schools to send your boat.": "Mapa. Loď můžete poslat i ze seznamu hejn.",
  "Schools": "Hejna",
  "Leaderboard": "Průběžné pořadí",
  "How to play": "Jak hrát",
  "Tap a school of fish to send your boat. It sails one tile every {seconds} s by the shortest route and follows the school as it swims. Everyone sees every boat.": "Klepnutím na hejno ryb tam pošlete svou loď. Pluje nejkratší cestou rychlostí jedno políčko za {seconds} s a hejno, které se pohybuje, sleduje. Všichni vidí všechny lodě.",
  "Every tile sailed burns {cost} Research. Out of Research, your boat waits: answer questions to refuel.": "Plavba spaluje výzkum: {cost} za každé propluté políčko. Když výzkum dojde, loď čeká: odpovídejte na otázky a doplňte palivo.",
  "On a school, your boat catches a fish every {seconds} s by itself. Schools regrow slowly, but boats sharing one empty it fast. An emptied school vanishes and a new one appears elsewhere.": "U hejna loď sama uloví rybu každých {seconds} s. Ryb v hejnech pomalu přibývá, ale více lodí u jednoho hejna ho rychle vyloví. Vylovené hejno zmizí a jinde se objeví nové.",
  "Golden schools appear every few minutes and swim off after a while. Each golden fish is worth {points} points.": "Každých pár minut se objeví zlatá hejna, která po chvíli odplují. Každá zlatá ryba má hodnotu {points} bodů.",
  "Score: fish caught plus golden points. Unused Research is worth nothing.": "Skóre: ulovené ryby plus body za zlaté ryby. Nevyužitý výzkum nemá žádnou hodnotu.",
  "A golden school is out": "Je venku zlaté hejno",
  "Your boat is idle": "Vaše loď kotví",
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
  "Reset the competition? This clears progress, scores and the game, and returns everyone to the waiting screen. Teams stay.": "Resetovat soutěž? Vymaže se postup, skóre i hra a všichni se vrátí na čekací obrazovku. Týmy zůstanou.",
  "Fish caught": "Ulovené ryby",
  "Golden points": "Body za zlaté ryby",
  "Match history (JSON)": "Historie zápasu (JSON)",
  "Changing age category resets this team’s progress, Research, skips, score and boat. Continue?": "Změna věkové kategorie resetuje postup tohoto týmu, výzkum, přeskočení, skóre a loď. Pokračovat?",
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
  "Your team has used all available skips.": "Váš tým už využil všechna dostupná přeskočení.",
  "Enter an answer first.": "Nejprve zadejte odpověď.",
  "Choose one answer.": "Vyberte jednu odpověď.",
  "Enter a number without units, using a decimal point or comma if needed.": "Zadejte číslo bez jednotek. Můžete použít desetinnou tečku nebo čárku.",
  "Endpoint not found.": "Požadovaná adresa nebyla nalezena.",
  "That code is already used by another team.": "Tento kód už používá jiný tým.",
  "Invalid JSON request.": "Neplatný požadavek JSON.",
  "The server could not complete this request. Please try again.": "Server nemohl požadavek dokončit. Zkuste to prosím znovu.",
  "That school has gone. Choose another one.": "Toto hejno už zmizelo. Vyberte jiné.",
  "Choose a sea tile.": "Vyberte políčko moře.",
  "The game has not started.": "Hra ještě nezačala."
}
export function t(english: string, values: Record<string, string | number> = {}): string {
  const text = language.value === 'cs' ? czech[english] ?? english : english
  return text.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match))
}
const czechSubjects: Record<Subject, string> = { physics: 'Fyzika', 'computer-science': 'Informatika', biology: 'Biologie', chemistry: 'Chemie', ess: 'ESS' }
export const subjectLabel = (subject: Subject) => language.value === 'cs' ? czechSubjects[subject] : subjectNames[subject]
// Czech needs the accusative after verbs such as "catch" (1 rybu, 2 ryby, 5 ryb).
export function fish(count: number, accusative = false): string {
  if (language.value === 'en') return `${count} fish`
  return `${count} ${count === 1 ? (accusative ? 'rybu' : 'ryba') : count >= 2 && count <= 4 ? 'ryby' : 'ryb'}`
}
// English has one plural; Czech has two (1 políčko, 2 políčka, 5 políček).
export function tiles(count: number): string {
  if (language.value === 'en') return `${count} ${count === 1 ? 'tile' : 'tiles'}`
  return `${count} ${count === 1 ? 'políčko' : count >= 2 && count <= 4 ? 'políčka' : 'políček'}`
}

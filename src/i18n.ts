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
  "Hold full: sailing home to unload ({tiles} to go)": "Náklad je plný: loď pluje vyložit do přístavu (zbývá {tiles})",
  "Sailing to a fishing ground: {tiles} to go": "Pluje k lovišti: zbývá {tiles}",
  "Sailing: {tiles} to go": "Pluje: zbývá {tiles}",
  "Fishing: next fish in about {seconds} s": "Loví: další ryba asi za {seconds} s",
  "Fishing, but this ground is empty and regrows slowly.": "Loví, ale loviště je prázdné a dorůstá jen pomalu.",
  "Idle. Tap a fishing ground on the map to send your boat.": "Kotví. Klepnutím na loviště v mapě tam pošlete svou loď.",
  "Fishing grounds": "Loviště",
  "Ground {count}/{max}": "Loviště {count}/{max}",
  "Golden ground {count}/{max}": "Zlaté loviště {count}/{max}",
  "healthy": "zdravé",
  "low": "slabé",
  "overfished": "přelovené",
  "crowded": "přeplněné",
  "{points} a fish": "{points} za rybu",
  "round trip to unload: {n} Research": "cesta vyložit a zpět: výzkum {n}",
  "{fish} + {bonus} golden": "{fish} + {bonus} za zlaté",
  "Fuel": "Palivo",
  "Hold": "Náklad",
  "Bait": "Návnada",
  "Catch {boost}% faster; {cost} Research a fish": "Lov o {boost} % rychlejší; výzkum {cost} za rybu",
  "Paused below {reserve} Research to keep fuel for sailing": "Pozastaveno: výzkum pod {reserve} šetří na plavbu",
  "Sending…": "Odesílání…",
  "Research; {cost} per tile": "výzkum; {cost} za políčko",
  "Go to questions": "K otázkám",
  "Map. Use the list of fishing grounds to send your boat.": "Mapa. Loď můžete poslat i ze seznamu lovišť.",
  "Leaderboard": "Průběžné pořadí",
  "How to play": "Jak hrát",
  "Tap a fishing ground to send your boat. It sails one tile every {seconds} s by the shortest route, and every tile burns {cost} Research: answer questions to refuel. Everyone sees every boat.": "Klepnutím na loviště tam pošlete svou loď. Pluje nejkratší cestou rychlostí jedno políčko za {seconds} s a každé políčko spálí výzkum ({cost}): palivo doplníte odpovídáním na otázky. Všichni vidí všechny lodě.",
  "On a ground your boat fishes by itself, and the more fish the ground has, the faster it catches them. Grounds never move. Each regrows up to {fish} every {seconds} s (just one when nearly empty, none when full), so boats sharing a ground empty it fast and then all catch slowly.": "Na lovišti loď loví sama, a čím víc ryb loviště má, tím rychleji je chytá. Loviště se nehýbou. Každé doroste až o {fish} za {seconds} s (téměř prázdné jen o jednu, plné vůbec), takže lodě, které se o loviště dělí, ho rychle vyloví a pak všechny loví pomalu.",
  "Your boat holds {fish}. When it is full it sails home to the harbour by itself to unload, then goes back, burning Research both ways. Grounds far from the harbour cost more fuel per fish.": "Do lodi se vejde {fish}. Když je plná, sama dopluje do přístavu vyložit a pak se vrátí, a výzkum spaluje oběma směry. Loviště daleko od přístavu proto stojí víc paliva na rybu.",
  "Golden grounds lie far out. Each golden fish is worth {points}, but a golden ground holds at most {max} and regrows only {growth} every {seconds} s.": "Zlatá loviště leží daleko. Každá zlatá ryba má hodnotu {points}, ale zlaté loviště má nejvýš {max} a doroste jen o {growth} za {seconds} s.",
  "Bait makes your boat catch {boost}% faster, but each fish caught with bait costs {cost} Research. Bait never takes you below {reserve} Research, which stays for sailing.": "S návnadou loď loví o {boost} % rychleji, ale každá ryba ulovená s návnadou stojí výzkum ({cost}). Návnada nikdy nesníží výzkum pod {reserve}; ten zůstane na plavbu.",
  "Score: fish caught plus golden points. Unused Research is worth nothing, and being first or fastest earns nothing: look in every few minutes and decide whether to stay or move.": "Skóre: ulovené ryby plus body za zlaté ryby. Nevyužitý výzkum nemá žádnou hodnotu a být první nebo nejrychlejší nic nepřináší: podívejte se do hry každých pár minut a rozhodněte, jestli zůstat, nebo se přesunout.",
  "Your boat is out of Research": "Vaší lodi došel výzkum",
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
  "Choose a fishing ground on the map.": "Vyberte loviště na mapě.",
  "Choose a sea tile.": "Vyberte políčko moře.",
  "The game has not started.": "Hra ještě nezačala."
}
export function t(english: string, values: Record<string, string | number> = {}): string {
  const text = language.value === 'cs' ? czech[english] ?? english : english
  return text.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match))
}
const czechSubjects: Record<Subject, string> = { physics: 'Fyzika', 'computer-science': 'Informatika', biology: 'Biologie', chemistry: 'Chemie', ess: 'ESS', math: 'Matematika' }
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
export function points(count: number): string {
  if (language.value === 'en') return `${count} ${count === 1 ? 'point' : 'points'}`
  return `${count} ${count === 1 ? 'bod' : count >= 2 && count <= 4 ? 'body' : 'bodů'}`
}

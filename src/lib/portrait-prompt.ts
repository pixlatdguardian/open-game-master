// What every face the server paints is drawn from, in the words an image
// model reads (issue 569). Each painter used to build its own prompt and each
// dropped something the record held: a companion's gender and appearance, an
// NPC's gender and role, a homebrew race's name, a dragonborn's colour. One
// builder per kind of subject, fed by callers that turn ids into words, so a
// field one painter reads every painter reads.
//
// Pure, so scripts/test-portrait-prompt.mjs reads the words without a render.

const FRAME = "Tabletop RPG character portrait, head and shoulders, centered, looking at viewer";
const FINISH = "Detailed digital painting, dramatic lighting, plain dark background";

// A character with a sheet: a player's, one in the library, a companion.
// Every field is words, never an id ("Marsh Folk", not "homebrew:<id>").
export type CharacterLook = {
  gender: string;
  race: string;
  // A dragonborn's dragon ("gold"), painted as the colour of their scales.
  ancestry?: string;
  // What the race looks like (src/lib/race-looks.ts), "" when nothing is
  // written for it.
  raceLook?: string;
  className: string;
  background: string;
  // What they look like, as the builder's Appearance field says it. A
  // companion the GM wrote has none and is painted from their personality.
  appearance: string;
  backstory: string;
};

// Deterministic, and genre-neutral unless the caller passes the campaign's
// portrait style: classes span all six genre catalogs.
//
// The player's Appearance comes first: an image model weighs what it reads
// early, and its idea of a race wins over a sentence after it (a dwarf
// written clean-shaven was painted bearded every time). The race's look
// follows the identity, then the class's clothes: a portrait with no
// clothing in its words was often painted without any.
export function characterPortraitPrompt(look: CharacterLook, style = ""): string {
  const race = look.ancestry && look.race ? `${look.ancestry}-scaled ${look.race}` : look.race;
  const identity = [look.gender, race, look.className].filter(Boolean).join(" ");
  return [
    FRAME,
    look.appearance,
    identity,
    look.raceLook ?? "",
    style,
    look.background ? `${look.background} background` : "",
    look.className ? `Wearing ${article(look.className)} ${look.className}'s clothes` : "",
    look.backstory.slice(0, 200),
    FINISH,
  ]
    .filter(Boolean)
    .join(". ");
}

// Who an NPC is at a glance: their gender, their people and what they do
// ("Female Wood Elf Merchant"). The name stays out: a render is not improved
// by a proper noun the model has never seen. The people rides because the
// placeholder an elf draws is an elf's, and a painted face replaces it.
export function npcIdentity(npc: { gender: string; race?: string; role: string }): string {
  return [npc.gender, npc.race?.trim(), npc.role.trim()].filter(Boolean).join(" ");
}

export type NpcLook = {
  gender: string;
  // Their people in words ("Wood Elf", src/lib/npc-race.ts raceWords).
  race?: string;
  // The role's label ("Merchant"), or the text the author typed.
  role: string;
  // What their people look like (src/lib/race-looks.ts).
  raceLook?: string;
  // Their distinguishing trait, in English.
  trait: string;
  // The engine's own English adjectives (describePersonality).
  personality: string;
};

// The trait leads, as a character's Appearance does.
export function npcPortraitPrompt(npc: NpcLook, style = ""): string {
  return [FRAME, npc.trait, npcIdentity(npc), npc.raceLook ?? "", style, npc.personality, FINISH].filter(Boolean).join(". ");
}

// "a" or "an" before a class's name, by its first letter's sound as
// written: "an artificer", "a warlock".
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

// An id as words ("hill_dwarf" is "hill dwarf"). A homebrew or workshop id
// ("homebrew:<id>", "homebrew-<id>") says nothing a reader can use, so it is
// "" when its name could not be found.
export function idWords(id: string): string {
  const value = id.trim();
  if (/^homebrew[:-]/.test(value)) {
    return "";
  }
  return value.replace(/[-_]/g, " ").trim();
}

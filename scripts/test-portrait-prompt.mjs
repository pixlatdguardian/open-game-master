// Issue 569 and its kin: every face the server paints is drawn from who the
// character is. A companion's portrait used to drop its gender (and a built
// companion's appearance), an NPC's dropped its gender and role, a homebrew
// race or workshop class reached the prompt and the AI GM as its id, a
// dragonborn's colour never reached it, and a drafted hero had no gender at
// all. These pin the words, then the doors that feed them.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";

const { characterPortraitPrompt, npcPortraitPrompt, npcIdentity, idWords } = await import("../src/lib/portrait-prompt.ts");
const { companionLook, libraryLook } = await import("../src/lib/portrait.ts");
const { createHomebrew, homebrewLabel, libraryLabels } = await import("../src/lib/db/homebrew.ts");
const { describeSheet } = await import("../src/lib/dm/prompt.ts");
const { raceWords, backgroundWords, classWords } = await import("../src/lib/sheet-words.ts");
const { parseDraftReply, draftSystemPrompt } = await import("../src/lib/dm/pregen-draft-logic.ts");

// Line endings as git wrote them: a Windows checkout reads CRLF.
const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const world = await openWorld();

await test("a character's prompt names the gender, the race, the class and the dragon's colour", () => {
  const prompt = characterPortraitPrompt({
    gender: "Female",
    race: "dragonborn",
    ancestry: "gold",
    className: "paladin",
    background: "acolyte",
    appearance: "a scar across the left cheek",
    backstory: "Raised in a mountain temple.",
  });
  assert.match(prompt, /\. Female gold-scaled dragonborn paladin\. /);
  assert.match(prompt, /acolyte background/);
  assert.match(prompt, /a scar across the left cheek/);
  assert.match(prompt, /Raised in a mountain temple/);
});

await test("an id that names nothing reads as no words, and an SRD id as its words", () => {
  assert.equal(idWords("hill_dwarf"), "hill dwarf");
  assert.equal(idWords("half-elf"), "half elf");
  assert.equal(idWords("homebrew:3f2a8b7c"), "");
  assert.equal(idWords("homebrew-3f2a8b7c"), "");
});

await test("a companion the GM wrote is painted with the gender on its sheet, from its personality (the issue)", () => {
  const hero = world.addHero({ class: "cleric", gender: "Female" });
  const sheet = world.sheet(hero.id);
  const look = companionLook(sheet, { personality: "Warm, wry, hums old hymns." });
  assert.equal(look.gender, "Female");
  const prompt = characterPortraitPrompt(look);
  assert.match(prompt, /\. Female human cleric\. /, prompt);
  assert.match(prompt, /Warm, wry, hums old hymns/);
});

await test("a companion built by hand is painted from its appearance, and a dragonborn's colour from the build or its feature", () => {
  const hero = world.addHero({ class: "paladin", race: "dragonborn", gender: "Female" });
  const sheet = world.sheet(hero.id);
  const built = companionLook(sheet, { personality: "Stern.", appearance: "silver braids, a dented shield", ancestry: "silver" });
  assert.equal(built.appearance, "silver braids, a dented shield");
  assert.match(characterPortraitPrompt(built), /Female silver-scaled dragonborn paladin/);
  // A campaign sheet keeps no racial choices; the race feature names the dragon.
  const featured = { ...sheet, features: [{ name: "Draconic Ancestry: Gold (fire, 15 ft. cone)", source: "race" }] };
  assert.equal(companionLook(featured, { personality: "Stern." }).ancestry, "gold");
});

await test("an NPC is painted as who they are at a glance: gender, people and role", () => {
  assert.equal(npcIdentity({ gender: "Female", role: "Merchant" }), "Female Merchant");
  // Their people rides with the rest: an elf whose plate is an elf's is
  // not painted over as a human.
  assert.equal(npcIdentity({ gender: "Female", race: "Wood Elf", role: "Archer" }), "Female Wood Elf Archer");
  assert.equal(npcIdentity({ gender: "", role: "" }), "");
  const prompt = npcPortraitPrompt({ gender: "Male", role: "Guard", trait: "a broken nose", personality: "gruff" });
  // The trait leads, so the model's idea of a guard does not paint over it.
  assert.match(prompt, /viewer\. a broken nose\. Male Guard\. gruff\. /);
});

await test("a homebrew race and background read as their names: on the sheet, to the AI GM and in the portrait", () => {
  const race = createHomebrew(world.owner.id, { kind: "race", name: "Marsh Folk", data: { desc: "" } });
  const background = createHomebrew(world.owner.id, { kind: "background", name: "Bog Warden", data: { desc: "" } });
  assert.equal(homebrewLabel(world.owner.id, `homebrew:${race.id}`, "race"), "Marsh Folk");
  assert.equal(homebrewLabel(world.owner.id, `homebrew:${race.id}`, "background"), undefined, "the kind must match");
  const hero = world.addHero({ class: "ranger", race: `homebrew:${race.id}`, background: `homebrew:${background.id}`, gender: "Male" });
  const sheet = world.sheet(hero.id);
  assert.equal(sheet.raceLabel, "Marsh Folk");
  assert.equal(sheet.backgroundLabel, "Bog Warden");
  assert.equal(raceWords(sheet), "Marsh Folk");
  assert.equal(backgroundWords(sheet), "Bog Warden");
  const line = describeSheet(sheet, "owner", false, {});
  assert.match(line, /Marsh Folk ranger/);
  assert.match(line, /Background: Bog Warden/);
  assert.doesNotMatch(line, /homebrew:/);
  assert.match(characterPortraitPrompt(companionLook(sheet, { personality: "" })), /Male Marsh Folk ranger\. Bog Warden background/);
  // And a library character's: the same names, for its pages and its portrait.
  const library = { userId: world.owner.id, race: sheet.race, class: "ranger", background: sheet.background };
  assert.deepEqual(libraryLabels(library), { raceLabel: "Marsh Folk", backgroundLabel: "Bog Warden" });
  const look = libraryLook({ ...library, sheet: { ...library, gender: "Male", appearance: "", backstory: "" } });
  assert.equal(look.race, "Marsh Folk");
  assert.equal(look.background, "Bog Warden");
  // A race whose entry is gone says nothing rather than its id.
  assert.equal(libraryLook({ ...library, race: "homebrew:gone", sheet: { ...library, race: "homebrew:gone" } }).race, "");
  assert.equal(classWords("fighter"), "fighter");
});

await test("the table's join note and the GM's lines name a species and class in words, never their ids", async () => {
  // The 0.31.1 playtest: "has joined the party as Mara Fen, a human
  // plague_doctor"; a hyphenated pack id ("bhain-kwai") kept its hyphen.
  assert.equal(classWords("plague_doctor"), "plague doctor");
  assert.equal(raceWords({ race: "bhain-kwai" }), "bhain kwai");
  assert.equal(raceWords({ race: "half_elf" }), "half elf");
  const { announceMidGameJoin } = await import("../src/lib/characters/mid-game-join.ts");
  const { listRecentMessages } = await import("../src/lib/db/messages.ts");
  announceMidGameJoin({ campaign: world.campaign(), user: world.owner }, { name: "Mara Fen", race: "half_elf", class: "plague_doctor", backstory: "" });
  const note = listRecentMessages(world.campaignId, 5).find((message) => message.content.includes("Mara Fen"))?.content ?? "";
  assert.match(note, /Mara Fen, a half elf plague doctor, joins the party\./, note);
});

await test("a content-pack species is painted from the builder's name for it, not its id", () => {
  if (!world.hasPack) {
    console.log("  (no content pack: skipped)");
    return;
  }
  // "bhain kwai" tells the painter nothing; the 0.31.1 playtest's minotaur
  // was given a human face.
  const library = { userId: world.owner.id, race: "bhain-kwai", class: "fighter", background: "soldier" };
  assert.equal(libraryLook({ ...library, sheet: { ...library, gender: "Male", appearance: "", backstory: "" } }).race, "Minotaur (Bhain Kwai)");
  const hero = world.addHero({ class: "fighter", race: "bhain-kwai", gender: "Male" });
  assert.match(characterPortraitPrompt(companionLook(world.sheet(hero.id), { personality: "" })), /Male Minotaur \(Bhain Kwai\) fighter/);
});

await test("a drafted hero keeps the gender the GM gave them, and none when it named none", () => {
  assert.match(draftSystemPrompt(1, { classes: ["fighter"], races: ["human"], backgrounds: ["soldier"] }), /"gender": "Female" \| "Male" \| "Nonbinary"/);
  const hero = { name: "Mira", concept: "a scout", class: "fighter", race: "human", background: "soldier", backstory: "She ran.", role: "tank" };
  const told = parseDraftReply(JSON.stringify({ heroes: [{ ...hero, gender: "female" }] }), 1);
  assert.equal(told.ok && told.heroes[0].gender, "Female");
  const untold = parseDraftReply(JSON.stringify({ heroes: [{ ...hero, gender: "wizard" }] }), 1);
  assert.equal(untold.ok && untold.heroes[0].gender, "");
  assert.match(read("src/lib/characters/pregen-drafts.ts"), /gender: proposal\.gender,/);
});

await test("every painter reads the shared prompt and the fields it needs", () => {
  const portrait = read("src/lib/portrait.ts");
  assert.doesNotMatch(portrait, /gender: ""/, "no painter blanks the gender");
  assert.match(portrait, /characterPortraitPrompt\(libraryLook\(character\)\)/);
  assert.match(portrait, /npcPortraitPrompt\(\{ gender: npc\.gender, race: raceWords\(npc\.race\), role,/);
  const tools = read("src/lib/dm/companion-tools.ts");
  assert.match(tools, /queueCompanionPortrait\(campaign, sheet, \{\n\s+personality,\n\s+appearance: input\.appearance,\n\s+ancestry: input\.racialChoices\?\.ancestry,/);
  for (const route of ["src/app/api/campaigns/[campaignId]/dm/npcs/route.ts", "src/app/api/campaigns/[campaignId]/dm/npcs/[npcId]/route.ts"]) {
    assert.match(read(route), /gender: (npc|outcome\.draft|saved)\.gender,\n\s+race: (npc|outcome\.draft|saved)\.race( \?\? "")?,\n\s+role: (npc|outcome\.draft|saved)\.role,/, route);
  }
  assert.match(read("src/lib/dm/world-ai.ts"), /npcIdentity\(\{ gender: npc\.gender, race: raceWords\(npc\.race\), role: npcRoleLabel\(npc\.role\) \}\)/);
});

await test("a companion's portrait can be painted again by whoever runs the story, and only for a companion", async () => {
  const route = await import("../src/app/api/campaigns/[campaignId]/companions/[characterId]/portrait/route.ts");
  const params = (characterId) => ({ params: Promise.resolve({ campaignId: world.campaignId, characterId }) });
  const hero = world.addHero({ class: "fighter" });
  // No session in this scratch world: the story door refuses before anything.
  const refused = await route.POST(new Request("http://localhost/"), params(hero.id));
  assert.equal(refused.status, 401);
  const source = read("src/app/api/campaigns/[campaignId]/companions/[characterId]/portrait/route.ts");
  assert.match(source, /requireStoryAuthority\(campaignId\)/);
  assert.match(source, /!sheet\.isCompanion/);
  assert.match(source, /imagesAvailable\(\)/);
  assert.match(source, /queueCompanionPortrait\(context\.campaign, cleared, \{\n\s+personality: cleared\.personality,/);
  const panel = read("src/app/campaigns/[campaignId]/PartyPanel.tsx");
  assert.match(panel, /sheet\.isCompanion && steersStory && canPaint \? \(\n\s+<CompanionPaintButton/);
});

await test("an older host, with no route for it, shows no Paint a portrait, and keeps the app's screens", async () => {
  const { hostOffers } = await import("../src/lib/use-capabilities.ts");
  const { SERVER_FEATURES } = await import("../src/lib/capabilities.ts");
  assert.equal(SERVER_FEATURES.companionPortrait, true, "this server says it has the route");
  const older = { story: { configured: true, reachable: true }, utility: { configured: true }, images: { configured: true, reachable: true, backend: "comfyui" }, tts: { configured: false, reachable: false }, stt: { configured: false }, voice: { enabled: false, mode: "off" } };
  assert.equal(hostOffers(older, "companionPortrait"), false, "a host that sends no flag lacks the route");
  assert.equal(hostOffers({ ...older, features: { companionPortrait: true } }, "companionPortrait"), true);
  assert.equal(hostOffers(null, "companionPortrait"), true, "unknown offers it, as every capability does");
  assert.match(read("src/app/campaigns/[campaignId]/PartyPanel.tsx"), /const canPaint = offersImages\(capabilities\) && hostOffers\(capabilities, "companionPortrait"\);/);
});

// Patch: a race's look written out (src/lib/race-looks.ts), the player's
// Appearance first, the class's clothes named.
const { raceLookFor } = await import("../src/lib/race-looks.ts");
const BUNDLED_RACES = JSON.parse(fs.readFileSync(new URL("../src/lib/srd/races.json", import.meta.url), "utf8")).races;

await test("a bundled race's look is written out, a subrace reads its people's, and nothing is guessed", () => {
  assert.match(raceLookFor("tiefling"), /Horns, a long thin tail/);
  assert.equal(raceLookFor("hill_dwarf"), raceLookFor("mountain_dwarf"));
  assert.match(raceLookFor("hill_dwarf"), /stocky/);
  // A content-pack copy of a bundled race reads the same row.
  assert.equal(raceLookFor("odm-hill-dwarf"), raceLookFor("hill_dwarf"));
  assert.equal(raceLookFor("human"), "");
  assert.equal(raceLookFor("homebrew:3f2a8b7c"), "");
  assert.equal(raceLookFor(undefined), "");
  const unwritten = BUNDLED_RACES.filter((race) => !raceLookFor(race.id)).map((race) => race.id);
  assert.deepEqual(unwritten, ["human", "variant_human"], "every bundled people but humans has a look");
});

await test("no race's look picks a colour, a hairstyle or a beard: those are the player's", () => {
  const theirs = /\b(red|blue|green|black|white|grey|gray|golden|silver|purple|pale|dark|beard|bearded|braid|braided|bald|moustache|mustache|long hair|short hair)\b/i;
  for (const race of BUNDLED_RACES) {
    assert.doesNotMatch(raceLookFor(race.id), theirs, race.id);
  }
});

await test("the Appearance leads, the race's look follows the identity, and the class's clothes are named", () => {
  const prompt = characterPortraitPrompt({
    gender: "Female",
    race: "tiefling",
    raceLook: raceLookFor("tiefling"),
    className: "warlock",
    background: "sage",
    appearance: "Pale blue skin, short silver hair",
    backstory: "",
  });
  assert.match(
    prompt,
    /^Tabletop RPG character portrait[^.]*\. Pale blue skin, short silver hair\. Female tiefling warlock\. Horns, a long thin tail[^.]*\. sage background\. Wearing a warlock's clothes\. Detailed/,
    prompt,
  );
  assert.match(characterPortraitPrompt({ gender: "", race: "", className: "artificer", background: "", appearance: "", backstory: "" }), /Wearing an artificer's clothes/);
  assert.doesNotMatch(characterPortraitPrompt({ gender: "", race: "elf", className: "", background: "", appearance: "", backstory: "" }), /Wearing/);
});

await test("every painter reads the race's look: a library character, a companion and an NPC", () => {
  const hero = world.addHero({ class: "warlock", race: "tiefling", gender: "Female" });
  assert.equal(companionLook(world.sheet(hero.id), { personality: "" }).raceLook, raceLookFor("tiefling"));
  assert.match(read("src/lib/portrait.ts"), /raceLook: raceLookFor\(sheet\.race\),\n\s+className: workshopClassName/);
  assert.match(read("src/lib/portrait.ts"), /raceLook: raceLookFor\(npc\.race\)/);
  const npc = npcPortraitPrompt({ gender: "Male", race: "Hill Dwarf", raceLook: raceLookFor("hill_dwarf"), role: "Smith", trait: "clean-shaven", personality: "" });
  assert.match(npc, /viewer\. clean-shaven\. Male Hill Dwarf Smith\. Short and stocky/);
});

console.log(`\n${passed} portrait prompt checks passed`);

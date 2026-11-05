import { srdRaceId } from "@/lib/srd/race-id";

// What a bundled race looks like, for the portrait painter
// (src/lib/portrait-prompt.ts). An image model often paints a bare race
// name as a human ("tiefling" without horns), so the features that make the
// people are written out.
//
// Body only: never a colour, a hairstyle or a beard. Those are the player's
// to choose, and a look that named one overrode what the sheet's Appearance
// said (a "red-skinned" tiefling written with blue skin came out red; a
// dwarf look with a beard put one on a dwarf written clean-shaven). A
// dragonborn's colour comes from its ancestry, not from here.
//
// Keyed by the bundled race id (src/lib/srd/races.json), so a content-pack
// copy of a bundled race reads the same row (srdRaceId). A homebrew or pack
// species with no row gets no words: it is painted from its name.
const LOOKS: Record<string, string> = {
  dwarf: "Short and stocky, broad-shouldered, with a broad, weathered face",
  elf: "Slender, with long pointed ears and fine, angular features",
  drow: "Slender, with long pointed ears and fine, angular features",
  halfling: "Small, with a round, youthful face and slightly pointed ears",
  dragonborn: "A draconic humanoid with a dragon-like head, a short snout and scales instead of skin",
  gnome: "Very small, with a large nose, a wide face and pointed ears",
  half_elf: "Slightly pointed ears",
  half_orc: "A strong jaw, a heavy brow and small tusks rising from the lower jaw",
  tiefling: "Horns, a long thin tail and solid-coloured eyes without pupils",
  aasimar: "A faint inner radiance and luminous eyes",
  goliath: "Very tall and massively built, with stone-like patterned markings across the skin",
  firbolg: "Very tall, with a broad, cow-like nose and large drooping ears",
  tabaxi: "A feline humanoid with a cat's head, fur, whiskers and a long tail",
  kenku: "A raven-like humanoid with a bird's head, a beak and feathers instead of hair",
  tortle: "A turtle-like humanoid with a beaked face, scaly skin and a large shell on the back",
  fire_genasi: "Flickering flames in place of hair",
  water_genasi: "Skin that glistens as if wet, and faint gills on the neck",
  air_genasi: "Hair that drifts as if in a breeze, and a faint swirl of wind about them",
  earth_genasi: "Skin like polished stone, faintly cracked",
  changeling: "A smooth, almost featureless face and eyes without pupils",
  warforged: "A humanoid construct of wood and metal plates, with a sculpted metal face",
  goblin: "Small, with long pointed ears, a flat nose and sharp teeth",
  bugbear: "Tall and hairy, with a bear-like face, long arms and pointed ears",
  lizardfolk: "A reptilian humanoid with a lizard's head, scales and a tail",
  orc: "Muscular, with a heavy brow, a strong jaw and tusks rising from the lower jaw",
};

// A subrace looks like its people: the bundled id ends in them.
const PEOPLE: Record<string, string> = {
  hill_dwarf: "dwarf",
  mountain_dwarf: "dwarf",
  high_elf: "elf",
  wood_elf: "elf",
  lightfoot_halfling: "halfling",
  stout_halfling: "halfling",
  rock_gnome: "gnome",
  forest_gnome: "gnome",
  deep_gnome: "gnome",
};

// The race's look in words, or "" when there is none to add (a human, a
// homebrew or pack species, no race at all).
export function raceLookFor(raceId: string | null | undefined): string {
  if (!raceId) {
    return "";
  }
  const id = srdRaceId(raceId);
  return LOOKS[PEOPLE[id] ?? id] ?? "";
}
